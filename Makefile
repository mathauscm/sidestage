UUID    = sidestage@mathauscm
VERSION = 1.0.0
SRC     = src
DIST    = dist
ZIP     = $(DIST)/$(UUID).shell-extension.zip
SYSDIR  = $(DESTDIR)/usr/share/gnome-shell/extensions/$(UUID)
SCHEMA  = org.gnome.shell.extensions.sidestage.gschema.xml

.PHONY: all pack package install uninstall install-system test clean

all: pack

# Zip in extensions.gnome.org format (install with "gnome-extensions install").
pack:
	@mkdir -p $(DIST)
	gnome-extensions pack $(SRC) --force --out-dir=$(DIST)

# pacman package: dist/gnome-shell-extension-sidestage-*.pkg.tar.zst
package:
	@mkdir -p $(DIST)
	cd packaging && PKGDEST=$(CURDIR)/$(DIST) makepkg -f --cleanbuild
	@rm -rf packaging/src packaging/pkg

# Install for your user only (~/.local), no root needed.
install: pack
	gnome-extensions install --force $(ZIP)
	@echo "Installed. Log out and back in, then run: gnome-extensions enable $(UUID)"

uninstall:
	-gnome-extensions disable $(UUID)
	-gnome-extensions uninstall $(UUID)

# Used by the PKGBUILD.
install-system:
	install -Dm644 -t $(SYSDIR) $(SRC)/metadata.json $(SRC)/extension.js $(SRC)/prefs.js $(SRC)/stylesheet.css
	install -Dm644 -t $(DESTDIR)/usr/share/glib-2.0/schemas $(SRC)/schemas/$(SCHEMA)

# Runs in an isolated headless gnome-shell (doesn't touch your session).
test:
	tests/run-headless.sh $(DIST)/test

clean:
	rm -rf $(DIST) packaging/src packaging/pkg
