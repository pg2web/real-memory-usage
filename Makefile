UUID := real-memory-usage@pg2web.github.io
INSTALL_DIR := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: pack install uninstall

# Zip for upload to extensions.gnome.org (the schema is compiled by GNOME on install)
pack:
	gnome-extensions pack --force --out-dir=. $(UUID)

# Copy into the user's extensions directory and compile the schema for local use
install:
	mkdir -p $(INSTALL_DIR)
	cp -r $(UUID)/. $(INSTALL_DIR)/
	glib-compile-schemas $(INSTALL_DIR)/schemas
	@echo "Log out and back in (Wayland), then: gnome-extensions enable $(UUID)"

uninstall:
	rm -rf $(INSTALL_DIR)
