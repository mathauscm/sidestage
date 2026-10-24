UUID    = sidestage@mathauscm
VERSION = 1.0.0
SRC     = src
DIST    = dist
ZIP     = $(DIST)/$(UUID).shell-extension.zip
SYSDIR  = $(DESTDIR)/usr/share/gnome-shell/extensions/$(UUID)
SCHEMA  = org.gnome.shell.extensions.sidestage.gschema.xml

.PHONY: all pack package install uninstall install-system test clean

all: pack

# Zip no formato do extensions.gnome.org (instala com "gnome-extensions install").
pack:
	@mkdir -p $(DIST)
	gnome-extensions pack $(SRC) --force --out-dir=$(DIST)

# Pacote do pacman: dist/gnome-shell-extension-sidestage-*.pkg.tar.zst
package:
	@mkdir -p $(DIST)
	cd packaging && PKGDEST=$(CURDIR)/$(DIST) makepkg -f --cleanbuild
	@rm -rf packaging/src packaging/pkg

# Instala só para o seu usuário (~/.local), sem senha.
install: pack
	gnome-extensions install --force $(ZIP)
	@echo "Instalado. Saia da sessão e entre de novo, depois: gnome-extensions enable $(UUID)"

uninstall:
	-gnome-extensions disable $(UUID)
	-gnome-extensions uninstall $(UUID)

# Usado pelo PKGBUILD.
install-system:
	install -Dm644 -t $(SYSDIR) $(SRC)/metadata.json $(SRC)/extension.js $(SRC)/prefs.js $(SRC)/stylesheet.css
	install -Dm644 -t $(DESTDIR)/usr/share/glib-2.0/schemas $(SRC)/schemas/$(SCHEMA)

# Roda num gnome-shell headless isolado (não mexe na sua sessão).
test:
	tests/run-headless.sh $(DIST)/test

clean:
	rm -rf $(DIST) packaging/src packaging/pkg
