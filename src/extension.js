// Sidestage — macOS Stage Manager-style sidebar for GNOME 51.
//
// How it works:
//  * On minimize we snapshot the window (once, on the GPU) and add a
//    thumbnail on the side of its monitor.
//  * GNOME's native minimize animation targets the window's "icon geometry".
//    We point that at the thumbnail, so the window flies straight into the
//    sidebar (and back out of it on restore) with no animation of ours
//    competing with the compositor's.
//  * Nothing runs in a loop: everything is signal-driven, and thumbnails are
//    static textures (not live clones), so the idle cost is zero.

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Mtk from 'gi://Mtk';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension, InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';

const MARGIN_X = 22;        // distance from the screen edge
const MARGIN_Y = 36;        // top/bottom room when the column fills up
const GAP = 22;             // space between thumbnails
const BADGE_SIZE = 32;      // app icon in the thumbnail corner
const RADIUS = 12;          // same radius as .sidestage-thumb in the CSS
const MOVE_TIME = 320;
const FADE_TIME = 200;
const FLY_TIME = 380;       // our minimize animation
const FLY_FALLBACK = 450;   // reveal the card anyway if the flight never ran
const HOVER_SCALE = 1.05;
const ASPECT_MIN = 0.45;    // height / width
const ASPECT_MAX = 1.6;
const FALLBACK_ASPECT = 0.625;

const ROUND_DECLARATIONS = `
uniform vec2 size;
uniform float radius;
`;

const ROUND_CODE = `
vec2 p = cogl_tex_coord_in[0].xy * size;
vec2 q = min(p, size - p);
if (q.x < radius && q.y < radius) {
    float d = length(vec2(radius) - q);
    cogl_color_out *= clamp(radius - d + 0.5, 0.0, 1.0);
}
`;

/** Rounds the snapshot's corners (St doesn't clip content to border-radius). */
const RoundedCornersEffect = GObject.registerClass(
class SidestageRoundedCornersEffect extends Clutter.ShaderEffect {
    vfunc_get_static_snippet() {
        return Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT,
            ROUND_DECLARATIONS, ROUND_CODE);
    }

    setGeometry(width, height, radius) {
        this.set_uniform_float('size', 2, [width, height]);
        this.set_uniform_float('radius', 1, [radius]);
    }
});

function clampAspect(aspect) {
    return Math.min(ASPECT_MAX, Math.max(ASPECT_MIN, aspect));
}

function appIcon(win, size) {
    const app = Shell.WindowTracker.get_default().get_window_app(win);
    if (app)
        return app.create_icon_texture(size);
    return new St.Icon({icon_name: 'application-x-executable', icon_size: size});
}

class Card {
    constructor(win, snapshot, width, tilt, side, onClicked) {
        this.win = win;
        this.aspect = snapshot ? snapshot.height / snapshot.width : FALLBACK_ASPECT;
        this.width = width;
        this.height = Math.round(width * this.aspect);
        this._destroyed = false;

        this.actor = new St.Button({
            reactive: true,
            track_hover: true,
            can_focus: false,
            button_mask: St.ButtonMask.ONE | St.ButtonMask.TWO,
            width: this.width,
            height: this.height,
            opacity: 0,
        });

        this._inner = new St.Widget({width: this.width, height: this.height});
        this._inner.set_pivot_point(0.5, 0.5);
        if (tilt > 0)
            this._inner.rotation_angle_y = side === 'left' ? tilt : -tilt;
        this.actor.set_child(this._inner);

        const thumb = new St.Widget({
            style_class: 'sidestage-thumb',
            width: this.width,
            height: this.height,
            layout_manager: new Clutter.BinLayout(),
        });
        if (snapshot) {
            // The snapshot is the whole window (shadow margin included); the
            // frame crops it down to the visible part of the window.
            const k = this.width / snapshot.width;
            const frame = new Clutter.Actor({
                width: this.width,
                height: this.height,
                clip_to_allocation: true,
            });
            const image = new Clutter.Actor({
                content: snapshot.content,
                x: -Math.round(snapshot.offsetX * k),
                y: -Math.round(snapshot.offsetY * k),
                width: Math.round(snapshot.fullWidth * k),
                height: Math.round(snapshot.fullHeight * k),
            });
            // Mipmaps: shrink 2000px down to 180px without aliasing.
            image.set_content_scaling_filters(
                Clutter.ScalingFilter.TRILINEAR, Clutter.ScalingFilter.LINEAR);
            frame.add_child(image);
            const rounded = new RoundedCornersEffect();
            rounded.setGeometry(this.width, this.height, RADIUS);
            frame.add_effect(rounded);
            thumb.add_child(frame);
        } else {
            thumb.add_style_class_name('sidestage-thumb-empty');
            const icon = appIcon(win, Math.min(64, Math.round(this.height * 0.5)));
            icon.x_align = icon.y_align = Clutter.ActorAlign.CENTER;
            thumb.add_child(icon);
        }
        this._inner.add_child(thumb);

        const badge = appIcon(win, BADGE_SIZE);
        badge.add_style_class_name('sidestage-badge');
        badge.set_position(-10, this.height - BADGE_SIZE + 10);
        this._inner.add_child(badge);

        this.actor.connect('notify::hover', () => {
            const scale = this.actor.hover ? HOVER_SCALE : 1;
            this._inner.ease({
                scale_x: scale,
                scale_y: scale,
                duration: 160,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        });
        this.actor.connect('clicked', (_b, button) => onClicked(win, button));
        this.actor.connect('destroy', () => (this._destroyed = true));
    }

    /** Places/moves the thumbnail. appear: null | 'fade' | 'fly'. */
    place(slot, animate, appear) {
        if (appear) {
            this.actor.remove_all_transitions();
            this.actor.set_position(slot.x, slot.y);
            this.actor.set_scale(slot.scale, slot.scale);
            // 'fly': the flying snapshot reveals the card when it lands.
            this.actor.ease({
                opacity: 255,
                delay: appear === 'fly' ? FLY_FALLBACK : 0,
                duration: FADE_TIME,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        } else if (animate) {
            this.actor.ease({
                x: slot.x,
                y: slot.y,
                scale_x: slot.scale,
                scale_y: slot.scale,
                opacity: 255,
                duration: MOVE_TIME,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        } else {
            this.actor.remove_all_transitions();
            this.actor.set_position(slot.x, slot.y);
            this.actor.set_scale(slot.scale, slot.scale);
            this.actor.opacity = 255;
        }
    }

    /** Shows the card at once (the flying snapshot just landed on it). */
    reveal() {
        if (this._destroyed)
            return;
        this.actor.remove_transition('opacity');
        this.actor.opacity = 255;
    }

    /** The thumbnail's on-screen rectangle, as currently drawn. */
    stageRect() {
        if (!this.actor.mapped)
            return null;
        const r = this.actor.get_transformed_extents();
        return {x: r.origin.x, y: r.origin.y, width: r.size.width, height: r.size.height};
    }

    destroy(animate = false) {
        if (this._destroyed)
            return;
        this.actor.reactive = false;
        if (animate && this.actor.mapped) {
            this.actor.ease({
                opacity: 0,
                duration: FADE_TIME,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onStopped: () => {
                    if (!this._destroyed)
                        this.actor.destroy();
                },
            });
        } else {
            this.actor.destroy();
        }
    }
}

export default class SidestageExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._cards = new Map();        // win -> Card
        this._snapshots = new Map();    // win -> {content, width, height}
        this._stamps = new Map();       // win -> order in which it was minimized
        this._flyRects = new Map();     // win -> target of the native animation
        this._flights = new Map();      // win -> thumbnail rect our minimize flies to
        this._flyingActors = new Set();
        this._tracked = new Set();
        this._stamp = 0;
        this._strips = [];
        this._relayoutId = 0;

        // Lives in the wallpaper group: windows pass over the sidebar, like on
        // macOS, and clicks on the thumbnails still work normally.
        const bgGroup = Main.layoutManager._backgroundGroup;
        this._layer = new Clutter.Actor({name: 'sidestage-layer'});
        bgGroup.add_child(this._layer);
        bgGroup.connectObject('child-added', (_group, child) => {
            if (child !== this._layer)
                bgGroup.set_child_above_sibling(this._layer, null);
        }, this);

        // GNOME reads the icon geometry inside _minimizeWindow/_unminimizeWindow,
        // right after calling _shouldAnimateActor. We write our target there so
        // Dash to Dock can't overwrite it in between.
        // For minimizing we skip GNOME's animation (it fades the window into a
        // see-through ghost) and fly an opaque snapshot ourselves.
        const self = this;
        const flyRects = this._flyRects;
        this._injections = new InjectionManager();
        this._injections.overrideMethod(Main.wm, '_shouldAnimateActor', original =>
            function (actor, types) {
                const win = actor?.meta_window;
                const flight = win ? self._flights.get(win) : null;
                if (flight && win.minimized) {
                    self._flights.delete(win);
                    const {reducedMotion} = St.Settings.get();
                    if (this._shouldAnimate() && reducedMotion !== St.ReducedMotion.REDUCE &&
                        self._fly(win, flight))
                        return false;
                }
                const rect = win ? flyRects.get(win) : null;
                if (rect) {
                    flyRects.delete(win);
                    win.set_icon_geometry(rect);
                }
                return original.call(this, actor, types);
            });

        this._buildStrips();

        const existing = global.get_window_actors()
            .map(a => a.meta_window)
            .filter(w => w)
            .sort((a, b) => (a.get_user_time() || 0) - (b.get_user_time() || 0));
        for (const win of existing) {
            this._track(win);
            if (win.minimized && this._isInteresting(win)) {
                this._stamps.set(win, ++this._stamp);
                this._capture(win);
            }
        }

        global.display.connectObject(
            'window-created', (_d, win) => this._track(win),
            'workareas-changed', () => this._rebuild(),
            this);
        global.workspace_manager.connectObject(
            'active-workspace-changed', () => this._relayout(false),
            this);
        Main.layoutManager.connectObject(
            'monitors-changed', () => this._rebuild(),
            this);
        this._settings.connectObject('changed', () => this._rebuild(), this);

        this._relayout(false);
    }

    disable() {
        this._injections.clear();
        this._injections = null;

        if (this._relayoutId) {
            GLib.source_remove(this._relayoutId);
            this._relayoutId = 0;
        }

        global.display.disconnectObject(this);
        global.workspace_manager.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);
        Main.layoutManager._backgroundGroup.disconnectObject(this);
        this._settings.disconnectObject(this);
        for (const win of this._tracked)
            win.disconnectObject(this);

        for (const actor of this._flyingActors)
            actor.destroy();
        for (const card of this._cards.values())
            card.destroy();
        this._layer.destroy();

        this._layer = null;
        this._strips = [];
        this._cards.clear();
        this._snapshots.clear();
        this._stamps.clear();
        this._flyRects.clear();
        this._flights.clear();
        this._flyingActors.clear();
        this._tracked.clear();
        this._settings = null;
    }

    _isInteresting(win) {
        return win.get_window_type() === Meta.WindowType.NORMAL &&
            !win.is_skip_taskbar();
    }

    _track(win) {
        if (this._tracked.has(win))
            return;
        this._tracked.add(win);
        win.connectObject(
            'notify::minimized', () => this._onMinimizedChanged(win),
            'workspace-changed', () => this._queueRelayout(),
            'unmanaged', () => this._forget(win),
            this);
    }

    _forget(win) {
        win.disconnectObject(this);
        this._tracked.delete(win);
        this._stamps.delete(win);
        this._snapshots.delete(win);
        this._flyRects.delete(win);
        this._flights.delete(win);
        this._relayout(true);
    }

    _onMinimizedChanged(win) {
        if (!this._isInteresting(win))
            return;

        if (win.minimized) {
            // The window is still on screen at this point: the animation only
            // starts later, when mutter processes its queue.
            this._capture(win);
            this._stamps.set(win, ++this._stamp);
            this._relayout(true, win);
        } else {
            const rect = this._cards.get(win)?.stageRect();
            if (rect)
                this._setFlyRect(win, rect);
            this._stamps.delete(win);
            this._snapshots.delete(win);
            this._relayout(true);
        }
    }

    /** Snapshot of the window + the crop (in the shape the thumbnail will use).
     *  Captures the whole actor: on mutter 51 the clip parameter shifts the image. */
    _capture(win) {
        const actor = win.get_compositor_private();
        if (!actor)
            return;

        const frame = win.get_frame_rect();
        const buffer = win.get_buffer_rect();
        let width = frame.width;
        let height = frame.height;
        if (width <= 0 || height <= 0)
            return;
        const aspect = height / width;
        if (aspect > ASPECT_MAX)
            height = Math.round(width * ASPECT_MAX);
        else if (aspect < ASPECT_MIN)
            width = Math.round(height / ASPECT_MIN);

        try {
            const content = actor.paint_to_content(null);
            if (content) {
                this._snapshots.set(win, {
                    content,
                    width,
                    height,
                    offsetX: frame.x - buffer.x,
                    offsetY: frame.y - buffer.y,
                    fullWidth: buffer.width,
                    fullHeight: buffer.height,
                });
            }
        } catch (e) {
            console.warn(`Sidestage: could not snapshot "${win.get_title()}": ${e.message}`);
        }
    }

    /** Makes the native animation land the window exactly on `thumb`. */
    _setFlyRect(win, thumb) {
        const frame = win.get_frame_rect();
        const buffer = win.get_buffer_rect();
        if (frame.width <= 0 || frame.height <= 0)
            return;
        const sx = thumb.width / frame.width;
        const sy = thumb.height / frame.height;
        const rect = new Mtk.Rectangle({
            x: Math.round(thumb.x - (frame.x - buffer.x) * sx),
            y: Math.round(thumb.y - (frame.y - buffer.y) * sy),
            width: Math.max(1, Math.round(buffer.width * sx)),
            height: Math.max(1, Math.round(buffer.height * sy)),
        });
        this._flyRects.set(win, rect);
        win.set_icon_geometry(rect);
    }

    /** Opaque snapshot shrinking from the window into its thumbnail, like
     *  macOS. Returns false (GNOME animates instead) when there's no snapshot. */
    _fly(win, thumb) {
        const snapshot = this._snapshots.get(win);
        if (!snapshot)
            return false;
        const frame = win.get_frame_rect();
        const k = thumb.width / snapshot.width;

        // Cropped exactly like the card, so the hand-off is seamless.
        const flyer = new Clutter.Actor({
            x: frame.x,
            y: frame.y,
            width: snapshot.width,
            height: snapshot.height,
            clip_to_allocation: true,
        });
        const image = new Clutter.Actor({
            content: snapshot.content,
            x: -snapshot.offsetX,
            y: -snapshot.offsetY,
            width: snapshot.fullWidth,
            height: snapshot.fullHeight,
        });
        image.set_content_scaling_filters(
            Clutter.ScalingFilter.TRILINEAR, Clutter.ScalingFilter.LINEAR);
        flyer.add_child(image);
        // Above the windows, below the top bar and the dock.
        Main.layoutManager.uiGroup.insert_child_above(flyer, global.window_group);
        this._flyingActors.add(flyer);

        flyer.ease({
            x: thumb.x,
            y: thumb.y,
            scale_x: k,
            scale_y: k,
            duration: FLY_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUART,
            onStopped: () => {
                this._cards.get(win)?.reveal();
                this._flyingActors.delete(flyer);
                flyer.destroy();
            },
        });
        return true;
    }

    _buildStrips() {
        for (const card of this._cards.values())
            card.destroy();
        this._cards.clear();
        for (const strip of this._strips)
            strip.actor.destroy();

        this._strips = Main.layoutManager.monitors.map((_monitor, index) => {
            const area = Main.layoutManager.getWorkAreaForMonitor(index);
            const actor = new Clutter.Actor({
                x: area.x,
                y: area.y,
                width: area.width,
                height: area.height,
            });
            this._layer.add_child(actor);
            return {actor, area, index};
        });
    }

    _rebuild() {
        this._buildStrips();
        this._relayout(false);
    }

    _queueRelayout() {
        if (this._relayoutId)
            return;
        this._relayoutId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._relayoutId = 0;
            this._relayout(true);
            return GLib.SOURCE_REMOVE;
        });
    }

    /** Minimized windows on the current workspace, newest first, per monitor. */
    _windowsByMonitor() {
        const workspace = global.workspace_manager.get_active_workspace();
        const allMonitors = this._settings.get_boolean('all-monitors');
        const maxCards = this._settings.get_int('max-cards');
        const primary = Main.layoutManager.primaryIndex;

        const windows = [...this._stamps.keys()]
            .filter(w => w.minimized && w.located_on_workspace(workspace))
            .sort((a, b) => this._stamps.get(b) - this._stamps.get(a));

        const byMonitor = new Map();
        for (const win of windows) {
            let monitor = allMonitors ? win.get_monitor() : primary;
            if (!this._strips[monitor])
                monitor = primary;
            if (!byMonitor.has(monitor))
                byMonitor.set(monitor, []);
            const list = byMonitor.get(monitor);
            if (list.length < maxCards)
                list.push(win);
        }
        return byMonitor;
    }

    _aspectOf(win) {
        const snapshot = this._snapshots.get(win);
        return snapshot ? snapshot.height / snapshot.width : FALLBACK_ASPECT;
    }

    /** Vertically centered column; shrinks everything if it doesn't fit. */
    _computeSlots(strip, windows) {
        const width = this._settings.get_int('card-width');
        const heights = windows.map(w => Math.round(width * clampAspect(this._aspectOf(w))));
        const total = heights.reduce((sum, h) => sum + h, 0) + GAP * (windows.length - 1);
        const available = strip.area.height - 2 * MARGIN_Y;
        const scale = Math.min(1, available / total);

        const x = this._settings.get_string('side') === 'right'
            ? strip.area.width - MARGIN_X - width * scale
            : MARGIN_X;
        let y = (strip.area.height - total * scale) / 2;

        return heights.map(h => {
            const slot = {
                x: Math.round(x),
                y: Math.round(y),
                scale,
                width: width * scale,
                height: h * scale,
            };
            y += (h + GAP) * scale;
            return slot;
        });
    }

    _relayout(animate, newWin = null) {
        if (!this._layer)
            return;

        const width = this._settings.get_int('card-width');
        const tilt = this._settings.get_int('tilt');
        const side = this._settings.get_string('side');
        const wanted = new Set();

        for (const [monitor, windows] of this._windowsByMonitor()) {
            const strip = this._strips[monitor];
            const slots = this._computeSlots(strip, windows);

            windows.forEach((win, i) => {
                wanted.add(win);
                let card = this._cards.get(win);
                if (card && card.monitor !== monitor) {
                    card.destroy();
                    card = null;
                }

                let appear = null;
                if (!card) {
                    card = new Card(win, this._snapshots.get(win), width, tilt, side,
                        (w, button) => this._onCardClicked(w, button));
                    card.monitor = monitor;
                    strip.actor.add_child(card.actor);
                    this._cards.set(win, card);
                    appear = win === newWin && animate ? 'fly' : 'fade';
                }
                card.place(slots[i], animate, appear);

                if (win === newWin) {
                    const thumb = {
                        x: strip.area.x + slots[i].x,
                        y: strip.area.y + slots[i].y,
                        width: slots[i].width,
                        height: slots[i].height,
                    };
                    // Native animation stays as the fallback target.
                    this._flights.set(win, thumb);
                    this._setFlyRect(win, thumb);
                }
            });
        }

        for (const [win, card] of [...this._cards]) {
            if (wanted.has(win))
                continue;
            this._cards.delete(win);
            card.destroy(animate);
        }
    }

    _onCardClicked(win, button) {
        if (button === 2) {
            if (this._settings.get_boolean('middle-click-close'))
                win.delete(global.get_current_time());
            return;
        }
        Main.activateWindow(win);
    }
}
