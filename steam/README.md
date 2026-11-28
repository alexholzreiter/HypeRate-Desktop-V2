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
   - The first heart rate and the first overlay unlock Spacewar's test achievements, as a stand-in for ours.

## When the App ID is there

1. **App ID.** In `src/steam.js`, set `APP_ID`. From then on, a packaged Steam build only runs when it is started through Steam. Started any other way, it hands itself to Steam.
2. **Achievements.** In the Steamworks portal (App Admin › Stats & Achievements), create the achievements with the API names from `ACHIEVEMENTS` in `src/steam.js`, and publish them.
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
