# HypeRate Desktop on Steam

The Steam build is the same app as the GitHub build. The differences:

- **steamworks.js is packed in.** The GitHub build leaves it out.
- **It gets its updates from Steam.** There is no own update check and no link to GitHub.
- **It talks to Steam** through `src/steam.js`.

## Trying it before we have an App ID

Until Valve finishes the partner review, the app uses **Spacewar (480)**. That is Valve's test app, and every Steam account has it.

1. Start Steam and sign in.
2. Start HypeRate Desktop in the Steam flavour:

   ```bash
   HYPERATE_DISTRIBUTION=steam npm start
   ```

3. Check the result:
   - Steam shows "Spacewar" as running.
   - Settings › Updates says who is signed in to Steam.
   - Four of our achievements (first heartbeat, first overlay, Bluetooth, first game moment) unlock Spacewar's four test achievements as stand-ins. The others are only logged.

## When the App ID is there

1. **App ID.** In `src/steam.js`, set `APP_ID`. From then on, a packaged Steam build only runs when it is started through Steam. Started any other way, it hands itself to Steam.
2. **Achievements.** Everything for the portal (App Admin › Stats & Achievements) is in `steam/achievements/`:
   - `achievements.json`: the two stats (`stat_minutes`, `stat_sessions`, type INT, increment only) and the 24 achievements, with API name, name and description in German and English, "hidden" for the two hidden ones, and the stat that shows progress.
   - `icons/`: one icon per achievement for "achieved" (`<id>.png`) and one for "unachieved" (`<id>_locked.png`), at 256 × 256, plus 64 × 64 in `icons/64/`.
   - `overview.html` shows all of them on one page.

   After changing texts or icons, run `npx electron tools/build-achievement-icons.js`. When an achievement unlocks is decided in `src/achievements.js`; `test/achievements.test.js` checks it.
3. **Depots.** In App Admin › SteamPipe › Depots, create one depot for Windows and one for macOS. Then fill in `APP_ID`, `WINDOWS_DEPOT_ID` and `MAC_DEPOT_ID` in `app_build.vdf` and the `depot_*.vdf` files.
4. **Builds.**

   ```bash
   npm run build:steam -- --win
   ```

   ```bash
   npm run build:steam -- --mac --universal
   ```

   This gives `dist-steam/win-unpacked` and `dist-steam/mac-universal`.
5. **Upload.** Use `steamcmd` from the Steamworks SDK (`tools/ContentBuilder/builder_osx` or `builder`), signed in with the build account:

   ```bash
   steamcmd +login <build account> +run_app_build "$PWD/steam/app_build.vdf" +quit
   ```

   Then put the build live in the portal. Use a beta branch first, for example `beta`.
6. **Launch options.** In App Admin › Installation › General, set the launch options:
   - Windows: `HypeRate Desktop.exe`
   - macOS: `HypeRate Desktop.app`

The SDK itself does not go into this repository. Only its runtime libraries ship with the app, and those come with steamworks.js.
