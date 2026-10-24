// Test scenario: runs inside an isolated gnome-shell --headless,
// minimizes/restores the test windows and saves screenshots + a JSON summary.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

Gio._promisify(Shell.Screenshot.prototype, 'screenshot');

const sleep = ms => new Promise(resolve =>
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    }));

export default class SidestageTestHarness extends Extension {
    enable() {
        this._out = GLib.getenv('SIDESTAGE_TEST_OUT');
        this._report = {steps: []};
        this._run().catch(e => this._report.error = `${e}\n${e.stack}`)
            .finally(() => this._write('report.json', JSON.stringify(this._report, null, 2)));
    }

    disable() {}

    _write(name, text) {
        GLib.file_set_contents(`${this._out}/${name}`, text);
    }

    async _shot(name) {
        const file = Gio.File.new_for_path(`${this._out}/${name}.png`);
        const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
        await new Shell.Screenshot().screenshot(false, stream);
        stream.close(null);
    }

    _windows() {
        return global.get_window_actors()
            .map(a => a.meta_window)
            .filter(w => w.get_window_type() === Meta.WindowType.NORMAL)
            .sort((a, b) => a.get_title().localeCompare(b.get_title()));
    }

    _cards() {
        const layer = Main.layoutManager._backgroundGroup.get_children()
            .find(c => c.name === 'sidestage-layer');
        if (!layer)
            return null;
        return layer.get_children().flatMap(strip => strip.get_children()).map(card => {
            const r = card.get_transformed_extents();
            return {
                x: Math.round(r.origin.x), y: Math.round(r.origin.y),
                w: Math.round(r.size.width), h: Math.round(r.size.height),
                opacity: card.opacity,
            };
        });
    }

    _step(name, extra = {}) {
        this._report.steps.push({
            name,
            windows: this._windows().map(w => ({title: w.get_title(), minimized: w.minimized})),
            cards: this._cards(),
            ...extra,
        });
    }

    async _run() {
        await sleep(1500);
        Main.overview.hide();

        for (let i = 0; i < 100 && this._windows().length < 3; i++)
            await sleep(200);
        await sleep(1500);
        const wins = this._windows();
        this._step('start');
        await this._shot('00-start');

        // Target GNOME will use for the minimize animation.
        wins[0].minimize();
        const [ok, geom] = wins[0].get_icon_geometry();
        await sleep(60);
        await this._shot('01a-minimizing');
        await sleep(90);
        await this._shot('01b-minimizing');
        await sleep(120);
        await this._shot('01c-minimizing');
        await sleep(500);
        this._step('one-minimized', {
            iconGeometry: ok ? {x: geom.x, y: geom.y, w: geom.width, h: geom.height} : null,
        });
        await this._shot('02-one-minimized');

        wins[1].minimize();
        await sleep(700);
        wins[2].minimize();
        await sleep(900);
        this._step('three-minimized');
        await this._shot('03-three-minimized');

        Main.activateWindow(wins[1]);
        await sleep(90);
        await this._shot('04-restoring');
        await sleep(800);
        this._step('one-restored');
        await this._shot('05-restored');

        global.workspace_manager.append_new_workspace(false, global.get_current_time());
        global.workspace_manager.get_workspace_by_index(1).activate(global.get_current_time());
        await sleep(900);
        this._step('other-workspace');
        global.workspace_manager.get_workspace_by_index(0).activate(global.get_current_time());
        await sleep(900);
        this._step('back-to-workspace');

        this._report.ok = true;
    }
}
