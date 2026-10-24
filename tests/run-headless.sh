#!/usr/bin/env bash
# Testa o Sidestage num gnome-shell --headless isolado: não mexe na sua sessão,
# nas suas extensões nem nas suas configurações (tudo vai para uma pasta temporária).
# Uso: tests/run-headless.sh [pasta-de-saida]
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/sidestage-test.XXXXXX")
OUT=${1:-$WORK/out}
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)
rm -f "$OUT"/*.png "$OUT"/report.json "$OUT"/*.log

export XDG_CONFIG_HOME=$WORK/config
export XDG_DATA_HOME=$WORK/data
export XDG_CACHE_HOME=$WORK/cache
EXT=$XDG_DATA_HOME/gnome-shell/extensions
mkdir -p "$EXT"
cp -r "$ROOT/src" "$EXT/sidestage@mathauscm"
glib-compile-schemas "$EXT/sidestage@mathauscm/schemas"
cp -r "$ROOT/tests/harness" "$EXT/sidestage-test@local"

export SIDESTAGE_TEST_OUT=$OUT ROOT
dbus-run-session -- bash -c '
    set -u
    gsettings set org.gnome.shell enabled-extensions "[\"sidestage@mathauscm\", \"sidestage-test@local\"]"
    gsettings set org.gnome.shell welcome-dialog-last-shown-version "999"
    DISPLAY_NAME=sidestage-test-$$
    gnome-shell --headless --no-x11 --virtual-monitor 1920x1080 \
        --wayland-display "$DISPLAY_NAME" > "$SIDESTAGE_TEST_OUT/shell.log" 2>&1 &
    SHELL_PID=$!
    sleep 3
    APPS=()
    i=0
    for spec in "Azul #2563eb 900 600" "Verde #16a34a 700 800" "Vermelho #dc2626 1200 500"; do
        set -- $spec
        WAYLAND_DISPLAY=$DISPLAY_NAME GDK_BACKEND=wayland \
            gjs -m "$ROOT/tests/window.js" "$1" "$2" "$3" "$4" >> "$SIDESTAGE_TEST_OUT/apps.log" 2>&1 &
        APPS+=($!)
    done
    for _ in $(seq 1 120); do
        [ -f "$SIDESTAGE_TEST_OUT/report.json" ] && break
        sleep 0.5
    done
    kill "${APPS[@]}" 2>/dev/null
    kill "$SHELL_PID" 2>/dev/null
    wait "$SHELL_PID" 2>/dev/null
    true
'

echo "Saída em: $OUT"
if [ -f "$OUT/report.json" ]; then
    cat "$OUT/report.json"
else
    echo "FALHOU: sem report.json"
fi
echo "--- erros/avisos do shell ligados ao Sidestage ---"
grep -iE "sidestage|JS ERROR|Extension .* error|TypeError|ReferenceError" "$OUT/shell.log" || echo "(nenhum)"
rm -rf "$WORK/config" "$WORK/data" "$WORK/cache"
