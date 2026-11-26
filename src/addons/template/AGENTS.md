# HypeRate Desktop addon: guide for AI assistants (and people)

<!-- HypeRate Desktop keeps this guide current; only the part under "## Your task" is yours. -->

This folder is an addon for **HypeRate Desktop**. You (Claude, Codex, …) may change the files in
this folder to build what the user asks for. Read this whole file first: **the user's task is at
the very end, under "Your task".** `example.js.txt` is a small working addon to learn from.

## What an addon is

Files in this folder:

- `addon.json` – name, version and what the addon is allowed to do
- `main.js` – the code. Plain JavaScript as in a web page: no build step, no Node.js, no
  `require`, no `import` and no npm packages. Everything goes into this one file.
- `overlay.html` (optional, with the `overlay` permission) – what the addon shows in the
  overlay, see "Showing something in the overlay" below.

The app runs `main.js` in a hidden, sandboxed window. It has **no access** to files, other apps,
the rest of HypeRate Desktop, the camera, the microphone or the network, except for what is
listed below and allowed in `addon.json`.

## addon.json

```json
{
  "id": "my-first-addon",
  "name": "My first addon",
  "version": "1.0.0",
  "description": "One sentence about what it does.",
  "author": "",
  "permissions": ["heartRate", "storage", "notifications"],
  "network": [],
  "settings": [
    { "key": "limit", "type": "number", "label": "Limit (BPM)", "default": 120, "min": 40, "max": 220 }
  ]
}
```

- `id`: lower case letters, digits and dashes, 2–40 characters, unique among the user's addons.
- `version`: raise it when you change the addon.
- `permissions`: only what the addon really needs. Possible values:
  - `heartRate` – the live heart rate
  - `zones` – the user's heart rate zones and the current one
  - `gameMoments` – moments from games (World of Warcraft, League of Legends)
  - `storage` – a small storage of its own (1 MB) that survives restarts
  - `notifications` – system notifications (at most one every 10 seconds)
  - `overlay` – show `overlay.html` in the overlay (needs that file and the `overlay` entry below)
  - `sound` – play sounds (Web Audio, or `new Audio('alarm.mp3')` with a file from this folder)
  - `discord` – put a short text of its own in the user's Discord status, under the heart rate
  - `vrchat` – write to the VRChat chatbox and set avatar parameters (over OSC)
  - `homeAssistant` – send events of its own to Home Assistant (over MQTT)

  These three go through the connections the user already set up in HypeRate Desktop
  (Integrations): the addon needs no `network` entry, no address and no key for them, and they
  only work while the user has that integration switched on.
- `network`: host names (no `https://`, no paths) the addon may call with `fetch`, for example
  `["api.example.com"]`. Only `https` works. Every other request is blocked. Leave it empty
  unless the addon must talk to a web service.

- `settings`: values the user can change in the app without touching the code, shown there as a
  form. Use them for anything a user might want to adjust (limits, colours, texts, modes) instead
  of constants in the code. Each entry: `key` (a simple name), `type` (`number`, `text`, `toggle`,
  `color` as `#rrggbb`, or `select` with `"options": ["a", "b"]`), `label`, `default`, and for
  numbers optionally `min` and `max`; `help` adds a short explanation. Changing a value does not
  need a new approval; changing code does.

- `overlay` (with the `overlay` permission), one of:
  - `{ "width": 300, "height": 120 }`: a window of that size in pixels (width 40–1200, height
    30–800), which the user drags where they want it and can scale in the app. A window
    takes the mouse while the pointer is over it (so it can be dragged), which is why the app
    shrinks windows that would cover more than a third of the screen;
  - `{ "mode": "screen" }`: the whole screen the overlay is on, for effects over everything
    (a glowing edge, a flash, a vignette). Clicks always go through it to the apps underneath,
    so the user can keep working; it cannot be moved or scaled and needs no size.

**Every change to any file of the addon makes the app ask the user again** before it runs, and
it shows the permissions and hosts, new ones highlighted. So ask for as little as possible: the
user decides.

## The API: `window.hyperate`

```js
hyperate.on('heartRate', ({ bpm }) => { … });          // needs "heartRate"; see "How often" below
hyperate.on('zone', (zone) => { … });                   // needs "zones"; zone = { name, color, min, max } or null
hyperate.on('gameMoment', ({ game, type, title, detail, bpm }) => { … });  // needs "gameMoments"
                                                         // game: "wow" | "lol"; title like "Boss Defeated";
                                                         // bpm: the peak heart rate of that moment (or null)
// gameMoment types: boss_defeated, close_call, closest_call, death, intense_enemy, nemesis,
// peak_heart_rate, kill_streak (WoW); kill, multikill, pentakill, first_blood, ace, objective,
// objective_stolen, victory, defeat (League of Legends). Compare "type", not "title".
await hyperate.storage.get('key');                      // needs "storage"; undefined if not set
await hyperate.storage.set('key', value);               // needs "storage"; value must be JSON-able
await hyperate.notify('Title', 'Text');                 // needs "notifications"; false if too soon, or if the
                                                         // system blocks notifications (the app then tells the
                                                         // user on the addon's page how to allow them)
await hyperate.settings.get();                          // { limit: 120, … }: the "settings" values
hyperate.on('settings', (values) => { … });             // the user changed a value in the app
hyperate.send({ any: 'data' });                          // to the other part: main.js → overlay.html or back
hyperate.on('message', (data) => { … });                // what the other part sent
hyperate.log('anything');                                // shows in the addon's log in the app

// Through the app's integrations; each returns a promise of { ok, reason }. reason: 'off' (the
// user has that integration off or it is not connected), 'too-fast', 'invalid' or 'permission'
await hyperate.discord.setStatus('Boss down at 142 BPM'); // needs "discord"; 2–100 characters, under the
                                                         // heart rate; null removes it; one change every 5 s,
                                                         // Discord itself shows one update per 15 s
await hyperate.vrchat.chatbox('GG! 142 BPM');            // needs "vrchat"; 144 characters, one every 2 s;
                                                         // stays up 10 s before the heart rate line comes back
await hyperate.vrchat.parameter('BossDown', true);      // needs "vrchat"; an avatar parameter (the name as in
                                                         // the avatar, without /avatar/parameters/); true/false
                                                         // = Bool, whole number = Int, decimal = Float; 20 a second
await hyperate.homeAssistant.event('boss_down', { bpm: 142 }); // needs "homeAssistant"; name: letters, digits,
                                                         // _ . -; data JSON-able, 8 KB at most; 5 a second.
// In Home Assistant it arrives on the MQTT topic hyperate/<device>/addon/<addon id> as
// { addon, event, data, at }; tell the user to use an automation with an MQTT trigger on that
// topic (the device part is the one shown under Integrations › Home Assistant).
fetch('https://api.example.com/…')                       // only hosts listed in "network"
```

How often `heartRate` comes depends on the source: a Bluetooth strap about once a second,
the HypeRate app over the internet about every 5 seconds, and gaps of 10 to 30 seconds happen
(a weak signal, a phone in the pocket). Never count samples or assume a fixed rate: work with
the time each value arrived (`Date.now()`), and treat only a long silence (60 seconds or more)
as a pause. A rule like "5 samples in 10 seconds" never fires over the internet.

`console.log`, `console.warn` and `console.error` also go to the addon's log, and errors thrown
by the addon show up there too. The user finds the log on the addon's own page in HypeRate
Desktop (Integrations › the addon's tile), together with a restart button.

## Showing something in the overlay

With the `overlay` permission, `overlay.html` is shown in a small window of its own next to the
HypeRate overlay. It comes and goes with the overlay (and its hotkey); the user drags it where
they want it, like the heart rate widget, and sets its size in the app. Clicks inside it are
not for the addon (pointing at it means "move it"): it only shows things.

- With `"mode": "screen"` the page is as big as the screen: use `100vw`/`100vh` or `vmin`,
  never fixed pixel sizes, and keep the middle free unless the effect is meant to cover it.
- The page background is transparent. Draw only what should be seen; keep it readable over
  any game (for example light text with a dark shadow, or a dark rounded box).
- Scripts and styles must be separate files in this folder: `<script src="overlay.js"></script>`
  and `<link rel="stylesheet" href="overlay.css">`. Inline `<script>` and `onclick="…"` are
  blocked; inline `style` attributes and `<style>` work. Fonts and images from this folder work.
- `window.hyperate` works there too, with the same permissions, so the overlay can listen to
  `heartRate` itself. For anything `main.js` works out (counters, timers, data from the web),
  send it over with `hyperate.send(…)` and listen with `hyperate.on('message', …)`.
  Both parts start on their own; do not rely on which one is first, and send the current
  state again when it changes.
- Keep it light: it runs during games. Animate with CSS rather than timers where possible.
  An addon that keeps using a lot of processor time is stopped by the app.
- **No fast flashing.** Large areas must not blink or change brightness more than three times
  a second: that can trigger seizures in people with photosensitive epilepsy. Fade or pulse
  slowly instead (one cycle per second or slower).

```html
<!doctype html>
<meta charset="utf-8">
<link rel="stylesheet" href="overlay.css">
<div id="count">0</div>
<script src="overlay.js"></script>
```

```js
// overlay.js
hyperate.on('message', ({ deaths }) => { document.getElementById('count').textContent = deaths; });
```

## Testing: the user must be able to try it out right away

Nobody wants to wait for a real boss kill or a real heart rate spike to see whether an addon
works. On the addon's page in the app, the card **Try it out** plays made-up events to this
addon only, at the pace of a real source (a value every 1 to 5 seconds):

- **Heart rate rises** / **falls**: 20 seconds steady (a baseline to compare with), then about
  40 % up or 28 % down over 8 seconds, 12 seconds there, then back. Needs `heartRate`.
  It starts from the user's current heart rate (kept between 60 and 110), or 75 without one:
  from 75 it rises to about 105 and falls to about 54. An addon with a fixed limit above that
  (say 120 BPM) is tried with **Through the zones** instead.
- **Through the zones**: from 60 to 185 BPM in 40 seconds, with `zone` events on the way
  (with `zones`).
- **Game moments**: WoW boss defeated, close call, death; LoL pentakill. Needs `gameMoments`.

While a run goes on, the addon gets no real heart rate. Every made-up event has
`simulated: true`; do not ignore it: the point is to see the addon react.

So:
1. Build the addon so that its effect shows during these runs with its **default settings**.
   An addon that waits for something rarer (a 50 % jump, a 3 minute streak) must still react
   to them, or say on its settings what to set for a quick test.
2. If it reacts to something the app cannot play (the time of day, data from the web, a count
   kept in storage, a long streak), add a toggle setting `"key": "test"` with the label
   "Test" (in the user's language) that shows the effect at once while it is on, as if the
   moment had come.
3. In your final answer, tell the user how to try it: which button on **Try it out**, or the
   **Test** setting, and what they should see.

## Sharing (only when the user asks for it)

The user shares an addon from its page in the app (**Share**): it goes into a public GitHub
repo, HypeRate checks it there and someone at HypeRate reads the code before others are
offered it. When the user asks you to prepare that:

1. Look through every file: no passwords, keys, tokens or personal data (names, addresses,
   IDs) may be in it. Set `"author"` in `addon.json` to the name the user wants to be shown
   with (ask them). For a new version, raise `"version"`.
2. Write `README.md` in this folder: what the addon does, which permissions and hosts it asks
   for and why, its settings, and how to try it out (see "Testing"). Wherever it names
   HypeRate Desktop, make that a link: `[HypeRate Desktop](https://www.hyperate.io)`. End it
   with this line:
   `Made for [HypeRate Desktop](https://www.hyperate.io), your heart rate in games and streams.`
3. Add `LICENSE` in this folder: MIT with the user's name and the year, unless they want
   another license.
4. Make a **public** GitHub repo holding exactly the files of this folder, at its top level.
   `AGENTS.md` and `WISHES.md` may be in it or not (the app ignores them). Add nothing else (no
   `.gitignore`, no workflows, no build output): HypeRate compares the files on GitHub with what
   the user tested here, and any difference shows up in the review. Several addons in one repo
   work too: one folder each, and the link then points at the folder
   (`https://github.com/<name>/<repo>/tree/main/<folder>`).
5. Commit and push with `git` (or `gh`) if you can; otherwise tell the user step by step how to
   upload the files on github.com.
6. Tell the user the link and that they paste it under **Share** on the addon's page, together
   with the name they want to show and, if they like, links to X, YouTube, Twitch or a website.

Adding `README.md` and `LICENSE` changes the folder, so the app asks the user once more to
approve the addon: that is expected. For a later version: raise `"version"`, update the README
if needed, push, then **Send a new version** in the app.

## Rules

- Never ask the user for passwords or keys inside the addon, and never send the heart rate
  anywhere the user did not ask for.
- Do not add permissions or hosts "just in case".
- Keep the code readable: the user may want to understand what it does before approving it.
- Keep `addon.json`'s `id` as it is; it names the folder. Raise `version` with every change.
- `main.js` has no page to draw on; anything visible goes into `overlay.html`.

## What is not possible (yet)

- Clicking things in the overlay: a window can only be dragged, a screen overlay lets clicks
  through. There are no buttons for the user to press there.
- Discord, VRChat or Home Assistant other than through `hyperate.discord`, `hyperate.vrchat` and
  `hyperate.homeAssistant`: no direct connection to them (OSC, Discord's local connection, a local
  Home Assistant address), and nothing beyond what those calls offer (no Discord messages, no
  reading from VRChat or Home Assistant).
- Keyboard shortcuts, reading or writing files outside this folder, other apps or windows,
  the microphone, the camera, the clipboard, starting programs.
- Running while HypeRate Desktop is closed. More than 1 MB of storage.
- One overlay over several monitors at once: a screen overlay covers the screen the HypeRate
  overlay is on.
- Showing anything over games in **exclusive full screen** (some Windows games): nothing can be
  drawn over those, not even the heart rate widget. In the game, "borderless window" works.
- Any network access not listed in `"network"`, and plain `http://`.

## When something the user wants is not possible

Do not try to get around the limits: the app blocks it, and the user would only see an error.
Instead:
1. build the closest thing that works, and say clearly what is missing and why,
2. write each missing piece into a file `WISHES.md` in this folder: one `## ` heading per
   wish, with two or three sentences on what the addon would need from HypeRate Desktop and
   what for. The app shows these wishes on the addon's page, where the user can send them to
   HypeRate. Remove a wish when it is no longer needed.

## When you are done

Tell the user, in their language:
1. what the addon does and which permissions and hosts it asks for, and why,
2. that it is in HypeRate Desktop under **Integrations**, as its own tile; switch it on there and
   confirm the permissions,
3. which settings they can change there,
4. if it shows something in the overlay: that it appears while the overlay is on, and that they
   move it by dragging it, like the heart rate widget (a `"mode": "screen"` addon covers the
   screen and lets every click through instead).
5. how to try it out right away (see "Testing" above).

The app notices every change by itself. Errors show on the addon's page with a button that copies
them for you, so the user may come back with an error message: fix it in this folder.
