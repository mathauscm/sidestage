import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class SidestagePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;

        const page = new Adw.PreferencesPage({
            title: 'Sidestage',
            icon_name: 'view-sidebar-start-symbolic',
        });
        window.add(page);

        const look = new Adw.PreferencesGroup({
            title: 'Appearance',
            description: 'Changes apply immediately.',
        });
        page.add(look);

        const side = new Adw.ComboRow({
            title: 'Screen side',
            model: Gtk.StringList.new(['Left', 'Right']),
            selected: settings.get_string('side') === 'right' ? 1 : 0,
        });
        side.connect('notify::selected', () =>
            settings.set_string('side', side.selected === 1 ? 'right' : 'left'));
        look.add(side);

        look.add(this._spin(settings, 'card-width', 'Thumbnail width',
            'In pixels', 120, 280, 10));
        look.add(this._spin(settings, 'max-cards', 'Maximum thumbnails',
            'Per monitor; older ones are hidden', 3, 15, 1));
        look.add(this._spin(settings, 'tilt', '3D tilt',
            'In degrees; 0 keeps thumbnails flat', 0, 25, 1));

        const behavior = new Adw.PreferencesGroup({title: 'Behavior'});
        page.add(behavior);

        behavior.add(this._switch(settings, 'all-monitors',
            'One column per monitor',
            'When off, all thumbnails go to the primary monitor'));
        behavior.add(this._switch(settings, 'middle-click-close',
            'Middle click closes the window', null));
    }

    _spin(settings, key, title, subtitle, min, max, step) {
        const row = Adw.SpinRow.new_with_range(min, max, step);
        row.title = title;
        row.subtitle = subtitle;
        settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _switch(settings, key, title, subtitle) {
        const row = new Adw.SwitchRow({title});
        if (subtitle)
            row.subtitle = subtitle;
        settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }
}
