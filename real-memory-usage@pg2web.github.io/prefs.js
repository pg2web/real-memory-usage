import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const COLOR_KEYS = [
    ['color-ok', 'Plenty available', 'Top bar colour while available memory is above the warning level'],
    ['color-warn', 'Warning', 'Top bar colour below the warning level'],
    ['color-crit', 'Critical', 'Top bar colour below the critical level'],
];

export default class RealMemoryUsagePrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(520, 640);

        const page = new Adw.PreferencesPage();
        window.add(page);

        // Refresh
        const refreshGroup = new Adw.PreferencesGroup({title: 'Refresh'});
        page.add(refreshGroup);
        const refreshRow = new Adw.SpinRow({
            title: 'Refresh interval',
            subtitle: 'Seconds between readings of /proc/meminfo',
            adjustment: new Gtk.Adjustment({lower: 1, upper: 60, step_increment: 1, page_increment: 5}),
        });
        settings.bind('refresh-seconds', refreshRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        refreshGroup.add(refreshRow);

        // Top bar mini bar
        const barGroup = new Adw.PreferencesGroup({title: 'Top bar'});
        page.add(barGroup);

        const showTextRow = new Adw.SwitchRow({
            title: 'Show text',
            subtitle: 'Text is always shown while the bar is hidden',
        });
        settings.bind('show-text', showTextRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        barGroup.add(showTextRow);

        const showRow = new Adw.SwitchRow({title: 'Show bar'});
        settings.bind('show-bar', showRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        barGroup.add(showRow);

        const positions = ['before', 'after'];
        const positionRow = new Adw.ComboRow({
            title: 'Position',
            subtitle: 'Relative to the available-memory text',
            model: Gtk.StringList.new(['Before the text', 'After the text']),
        });
        const syncPosition = () => {
            positionRow.selected = Math.max(0, positions.indexOf(settings.get_string('bar-position')));
        };
        syncPosition();
        positionRow.connect('notify::selected', () => {
            const value = positions[positionRow.selected];
            if (value !== settings.get_string('bar-position'))
                settings.set_string('bar-position', value);
        });
        barGroup.add(positionRow);

        for (const [key, title] of [['bar-width', 'Width (px)'], ['bar-height', 'Height (px)']]) {
            const row = new Adw.SpinRow({
                title,
                adjustment: new Gtk.Adjustment({
                    lower: key === 'bar-width' ? 10 : 2,
                    upper: key === 'bar-width' ? 300 : 24,
                    step_increment: 1,
                    page_increment: 10,
                }),
            });
            settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
            barGroup.add(row);
        }

        // Thresholds
        const thresholdGroup = new Adw.PreferencesGroup({
            title: 'Thresholds',
            description: 'Available memory as a percentage of total memory',
        });
        page.add(thresholdGroup);
        for (const [key, title, subtitle] of [
            ['warn-percent', 'Warning below (%)', 'Top bar switches to the warning colour'],
            ['crit-percent', 'Critical below (%)', 'Top bar switches to the critical colour'],
        ]) {
            const row = new Adw.SpinRow({
                title,
                subtitle,
                adjustment: new Gtk.Adjustment({lower: 1, upper: 100, step_increment: 1, page_increment: 5}),
            });
            settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
            thresholdGroup.add(row);
        }

        // Colours
        const colorGroup = new Adw.PreferencesGroup({title: 'Colours'});
        page.add(colorGroup);
        const buttons = [];
        for (const [key, title, subtitle] of COLOR_KEYS) {
            const row = new Adw.ActionRow({title, subtitle});
            const button = new Gtk.ColorDialogButton({
                dialog: new Gtk.ColorDialog({with_alpha: false}),
                valign: Gtk.Align.CENTER,
            });
            const load = () => {
                const rgba = new Gdk.RGBA();
                if (rgba.parse(settings.get_string(key)))
                    button.set_rgba(rgba);
            };
            load();
            button.connect('notify::rgba', () => {
                const text = button.get_rgba().to_string();
                if (text !== settings.get_string(key))
                    settings.set_string(key, text);
            });
            buttons.push(load);
            row.add_suffix(button);
            row.activatable_widget = button;
            colorGroup.add(row);
        }

        // Reset
        const resetGroup = new Adw.PreferencesGroup();
        page.add(resetGroup);
        const resetRow = new Adw.ActionRow({title: 'Reset to defaults'});
        const resetButton = new Gtk.Button({label: 'Reset', valign: Gtk.Align.CENTER});
        resetButton.add_css_class('destructive-action');
        resetButton.connect('clicked', () => {
            for (const key of ['refresh-seconds', 'warn-percent', 'crit-percent',
                'color-ok', 'color-warn', 'color-crit',
                'show-text', 'show-bar', 'bar-position', 'bar-width', 'bar-height'])
                settings.reset(key);
            buttons.forEach(load => load());
            syncPosition();
        });
        resetRow.add_suffix(resetButton);
        resetGroup.add(resetRow);
    }
}
