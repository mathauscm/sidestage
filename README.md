# Sidestage

A GNOME 51 extension inspired by macOS Stage Manager: when you minimize a
window, it **flies straight into a thumbnail on the side of the screen**.
Click the thumbnail and the window grows back out of it.

- Shows only **minimized** windows from the current workspace.
- Each monitor gets its own column (or everything on the primary one, if you prefer).
- Click: restores just that window, leaving the others alone.
- Middle click: closes the window.
- Open windows stay **on top** of the column, just like on the Mac.

## Why it's lightweight

- The minimize/restore animation is **GNOME's native one** (run by the
  compositor); Sidestage only tells it where the window should go.
- Thumbnails are a **snapshot taken once**, at the moment of minimizing, not a
  live clone. While idle, Sidestage uses no CPU or GPU.
- Nothing runs in a loop: everything reacts to events (minimize, restore,
  workspace switch, monitor change).
- Snapshots are downscaled with mipmaps (trilinear filtering), so thumbnails
  stay sharp with no jagged edges.

## Install

### As a system package (recommended on Arch / CachyOS)

```sh
make package
sudo pacman -U dist/gnome-shell-extension-sidestage-1.0.1-1-any.pkg.tar.zst
```

Then **log out and back in** (on Wayland, GNOME only loads new extensions at
login) and enable it:

```sh
gnome-extensions enable sidestage@mathauscm
```

To remove: `sudo pacman -R gnome-shell-extension-sidestage`.

### For your user only (no root needed)

```sh
make install
```

Log out, log back in and run `gnome-extensions enable sidestage@mathauscm`.
To remove: `make uninstall`.

## Settings

Open them from the **Extensions** app (Sidestage's gear button) or with
`gnome-extensions prefs sidestage@mathauscm`:

| Option | Default |
|---|---|
| Screen side | Left |
| Thumbnail width | 180 px |
| Maximum thumbnails per monitor | 8 |
| 3D tilt | 0° (flat) |
| One column per monitor | On |
| Middle click closes the window | On |

## Development

```
src/                 the extension (this is what gets packaged)
  extension.js       logic, thumbnails and animation
  prefs.js           preferences window (libadwaita)
  stylesheet.css     thumbnail styling
  schemas/           settings (GSettings)
packaging/PKGBUILD   pacman package
tests/               automated test in a headless GNOME Shell
```

`make test` starts an **isolated** `gnome-shell --headless` (settings and
extensions live in a temporary folder, your session is never touched), opens
three windows, minimizes them, restores one, switches workspaces and saves
screenshots plus a `report.json` to `dist/test/`.

### Technical notes

- GNOME animates minimizing towards the window's *icon geometry* (that's how
  it reaches the dock icon). Sidestage writes the thumbnail's position into
  that field right before the animation, inside `Main.wm._shouldAnimateActor`,
  so Dash to Dock can't overwrite it.
- The column lives inside the wallpaper group
  (`Main.layoutManager._backgroundGroup`), which is why it sits below windows.
- On mutter 51, `paint_to_content(clip)` shifts the image, so the snapshot
  covers the whole window and the crop (without the shadow margin) is done
  in the thumbnail.
- The extension stays enabled on the lock screen (`unlock-dialog`) only so
  the snapshots of minimized windows aren't lost when you lock the screen.
