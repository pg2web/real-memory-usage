import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const BAR_WIDTH = 340;
const BAR_HEIGHT = 14;

const KIB_PER_GIB = 1024 * 1024;

function readMemInfo() {
    const [ok, bytes] = GLib.file_get_contents('/proc/meminfo');
    if (!ok)
        return null;
    const info = {};
    for (const line of new TextDecoder().decode(bytes).split('\n')) {
        const m = line.match(/^([^:]+):\s+(\d+)/);
        if (m)
            info[m[1]] = Number(m[2]); // kB (or a plain count for HugePages_*)
    }
    return info;
}

function compute(info) {
    const g = key => info[key] ?? 0;

    const total = g('MemTotal');
    const free = g('MemFree');
    const available = g('MemAvailable');
    const used = Math.max(0, total - available);

    const apps = g('AnonPages');
    const shared = g('Shmem');
    const other = Math.max(0, used - apps - shared);
    const cache = Math.max(0, available - free);

    const hugeSize = g('Hugepagesize');
    return {
        total, free, available, used, apps, shared, other, cache,
        swapTotal: g('SwapTotal'),
        swapUsed: Math.max(0, g('SwapTotal') - g('SwapFree')),
        hugeTotal: g('HugePages_Total'),
        hugeFree: g('HugePages_Free'),
        hugeRsvd: g('HugePages_Rsvd'),
        hugeSize,
    };
}

function gib(kib) {
    return `${(kib / KIB_PER_GIB).toFixed(2)} GiB`;
}

function pct(part, total) {
    return total > 0 ? `${(100 * part / total).toFixed(1)}%` : '-';
}

const SEGMENTS = [
    ['apps', 'rmu-apps'],
    ['shared', 'rmu-shared'],
    ['other', 'rmu-kernel'],
    ['cache', 'rmu-cache'],
    ['free', 'rmu-free'],
];

// Stacked memory bar used both in the panel and in the dropdown
function createBar() {
    const actor = new St.BoxLayout({
        style_class: 'rmu-bar',
        clip_to_allocation: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const segments = {};
    for (const [key, cls] of SEGMENTS) {
        segments[key] = new St.Widget({style_class: `rmu-seg ${cls}`});
        actor.add_child(segments[key]);
    }
    return {actor, segments, sizeKey: ''};
}

function updateBar(bar, m, width, height) {
    const sizeKey = `${width}x${height}`;
    if (bar.sizeKey !== sizeKey) {
        bar.sizeKey = sizeKey;
        bar.actor.style = `width: ${width}px; height: ${height}px; border-radius: ${height / 2}px;`;
        for (const [key] of SEGMENTS)
            bar.segments[key].height = height;
    }
    // Normalise by the segment sum so rounding/clamping never overflows
    const sum = SEGMENTS.reduce((s, [k]) => s + m[k], 0) || 1;
    for (const [key] of SEGMENTS)
        bar.segments[key].width = Math.round(width * m[key] / sum);
}

const MemoryIndicator = GObject.registerClass(
class MemoryIndicator extends PanelMenu.Button {
    _init(extension, settings) {
        super._init(0.0, 'Real Memory Usage', false);

        this._extension = extension;
        this._settings = settings;

        this._label = new St.Label({
            text: '… GiB',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._panelBar = createBar();
        this._panelBox = new St.BoxLayout({style: 'spacing: 6px;'});
        this._panelBox.add_child(this._panelBar.actor);
        this._panelBox.add_child(this._label);
        this.add_child(this._panelBox);

        this.connect('captured-event', this._onCapturedEvent.bind(this));

        this._buildMenu();
        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this._update();
        });

        this._settingsChangedId = this._settings.connect('changed', (_s, key) => {
            if (key === 'refresh-seconds')
                this._startTimer();
            this._update();
        });

        this._update();
        this._startTimer();
    }

    _startTimer() {
        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);
        this._timeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, this._settings.get_int('refresh-seconds'), () => {
                this._update();
                return GLib.SOURCE_CONTINUE;
            });
    }

    // Right click opens the settings window instead of the dropdown.
    // Handled in captured-event so it runs before the panel button's own handling.
    _onCapturedEvent(_actor, event) {
        const type = event.type();
        if (type !== Clutter.EventType.BUTTON_PRESS &&
            type !== Clutter.EventType.BUTTON_RELEASE)
            return Clutter.EVENT_PROPAGATE;
        if (event.get_button() !== Clutter.BUTTON_SECONDARY)
            return Clutter.EVENT_PROPAGATE;

        if (type === Clutter.EventType.BUTTON_PRESS) {
            this.menu.close();
            this._extension.openPreferences();
        }
        return Clutter.EVENT_STOP;
    }

    _buildMenu() {
        this._header = new St.Label({style_class: 'rmu-header', text: ''});
        const headerItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        headerItem.add_child(this._header);
        this.menu.addMenuItem(headerItem);

        this._bar = createBar();
        const barItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        barItem.add_child(this._bar.actor);
        this.menu.addMenuItem(barItem);

        this._rows = {};

        const breakdown = [
            ['apps',   'rmu-apps',   'Apps (anonymous memory)'],
            ['shared', 'rmu-shared', 'Shared / tmpfs (not reclaimable)'],
            ['other',  'rmu-kernel', 'Kernel & other'],
            ['cache',  'rmu-cache',  'Cache (reclaimable)'],
            ['free',   'rmu-free',   'Free'],
        ];
        for (const [key, cls, title] of breakdown) {
            this._rows[key] = this._addRow(title, cls);
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._rows.total = this._addRow('Total');
        this._rows.used = this._addRow('Used');
        this._rows.available = this._addRow('Available', null, true);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._rows.swap = this._addRow('Swap used');
        this._hugeSeparator = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this._hugeSeparator);
        this._rows.huge = this._addRow('Hugepages free (unreserved)');
    }

    _addRow(title, swatchClass = null, strong = false) {
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const box = new St.BoxLayout({x_expand: true});

        if (swatchClass) {
            box.add_child(new St.Widget({
                style_class: `rmu-swatch ${swatchClass}`,
                y_align: Clutter.ActorAlign.CENTER,
            }));
        } else {
            box.add_child(new St.Widget({style_class: 'rmu-swatch'}));
        }

        const strongCls = strong ? ' rmu-strong' : '';
        const name = new St.Label({text: title, style_class: `rmu-row-name${strongCls}`, x_expand: true});
        const value = new St.Label({text: '', style_class: `rmu-row-value${strongCls}`});
        const percent = new St.Label({text: '', style_class: `rmu-row-pct${strongCls}`});
        box.add_child(name);
        box.add_child(value);
        box.add_child(percent);

        item.add_child(box);
        this.menu.addMenuItem(item);
        return {item, value, percent};
    }

    _setRow(key, kib, total) {
        this._rows[key].value.text = gib(kib);
        this._rows[key].percent.text = pct(kib, total);
    }

    _update() {
        const info = readMemInfo();
        if (!info)
            return;
        const m = compute(info);

        // Top bar label + colour
        this._label.text = `${(m.available / KIB_PER_GIB).toFixed(1)} GiB free`;
        const availPct = m.total > 0 ? 100 * m.available / m.total : 100;
        let color = this._settings.get_string('color-ok');
        let weight = 'normal';
        if (availPct < this._settings.get_int('crit-percent')) {
            color = this._settings.get_string('color-crit');
            weight = 'bold';
        } else if (availPct < this._settings.get_int('warn-percent')) {
            color = this._settings.get_string('color-warn');
        }
        this._label.style = `color: ${color}; font-weight: ${weight};`;

        this._header.text = `Available: ${gib(m.available)} of ${gib(m.total)}`;

        updateBar(this._bar, m, BAR_WIDTH, BAR_HEIGHT);

        // Panel bar: visibility, position (before/after the text) and size
        const showBar = this._settings.get_boolean('show-bar');
        this._panelBar.actor.visible = showBar;
        // Never hide both, or there would be nothing left to right click
        this._label.visible = this._settings.get_boolean('show-text') || !showBar;
        if (showBar) {
            const after = this._settings.get_string('bar-position') === 'after';
            this._panelBox.set_child_at_index(this._panelBar.actor, after ? 1 : 0);
            updateBar(this._panelBar, m,
                this._settings.get_int('bar-width'), this._settings.get_int('bar-height'));
        }

        for (const [k] of SEGMENTS)
            this._setRow(k, m[k], m.total);
        this._setRow('total', m.total, m.total);
        this._setRow('used', m.used, m.total);
        this._setRow('available', m.available, m.total);

        this._rows.swap.value.text = m.swapTotal > 0
            ? `${gib(m.swapUsed)}` : 'no swap';
        this._rows.swap.percent.text = m.swapTotal > 0 ? pct(m.swapUsed, m.swapTotal) : '';

        const showHuge = m.hugeTotal > 0;
        this._hugeSeparator.visible = showHuge;
        this._rows.huge.item.visible = showHuge;
        if (showHuge) {
            const freePages = Math.max(0, m.hugeFree - m.hugeRsvd);
            this._rows.huge.value.text = gib(freePages * m.hugeSize);
            this._rows.huge.percent.text = `${freePages}/${m.hugeTotal}`;
        }
    }

    destroy() {
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
        super.destroy();
    }
});

export default class RealMemoryUsageExtension extends Extension {
    enable() {
        this._indicator = new MemoryIndicator(this, this.getSettings());
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
