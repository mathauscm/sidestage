// Colored GTK4 window for the test: gjs -m window.js "Title" "#color" width height
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

const [title, color, width, height] = ARGV;

Gtk.init();
const win = new Gtk.Window({
    title,
    default_width: Number(width),
    default_height: Number(height),
});
const css = new Gtk.CssProvider();
css.load_from_string(`window { background: ${color}; } label { font-size: 56px; font-weight: bold; color: white; }`);
Gtk.StyleContext.add_provider_for_display(win.get_display(), css,
    Gtk.STYLE_PROVIDER_PRIORITY_USER);
win.set_child(new Gtk.Label({label: title}));
win.present();

const loop = GLib.MainLoop.new(null, false);
win.connect('close-request', () => {
    loop.quit();
    return false;
});
loop.run();
