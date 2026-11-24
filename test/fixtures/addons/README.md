# Example addons

Small addons that cover what the addon system can do and where it stops. `test/addons-e2e.test.js`
runs them in a real Electron before every release; they also work as starting points.

| Folder | Shows |
|---|---|
| `tile` | an overlay window (moved like the heart rate widget), `hyperate.send` between both parts |
| `screen-edge` | `"mode": "screen"`: a red edge over the whole screen, clicks always go through |
| `too-big` | an overlay window that would cover too much of the screen and is made smaller |
| `blocked` | what is not allowed: a host not in `network`, inline script, storage without permission |
| `sound` | the `sound` permission (without it an addon is muted) |
| `busy` | an addon that uses too much processor time and is stopped |
| `wishes` | `WISHES.md` with what the AI could not build, and an outdated `AGENTS.md` |
