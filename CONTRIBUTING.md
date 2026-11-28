# Contributing

Thanks for wanting to help. This is a small project, so the rules are short.

## Before you open a pull request

**1. Every user-facing string needs both languages.**

The app ships English and German. Text in the settings window is marked up with
`data-i18n="key"` (or `data-i18n-html="key"` when it contains markup) and the key
goes into both tables in `src/windows/settings/index.html`, near the top of the
script block:

```js
const I18N = {
  en: { my_label: 'Heart rate', … },
  de: { my_label: 'Herzfrequenz', … },
};
```

Strings built in JavaScript go through `t('my_label')`. A hardcoded English
label is the single most common reason a pull request here needs another round.
If your German is shaky, write the English and say so in the pull request, it is
easier to fix a translation than to find the places that were missed.

**2. `npm test` has to pass.**

```bash
npm test
```

The suite is hand-rolled, no framework: `test/run.js` runs every `*.test.js`
next to it, each file prints `PASS` / `FAIL` lines and exits non-zero on the
first failure.

**3. New logic comes with a test.**

Not every change, but anything with rules in it: parsing, a calculation, a
decision about what gets sent. Pull a pure function out and test that. The
existing files show the shape, `test/mqtt.test.js` and `test/sessions.test.js`
are the ones worth copying from. Tests must run without a display, without a
device, and without the internet. `test/helpers/` holds a small MQTT broker for
exactly that reason.

## Running it

```bash
npm install
npm start
```

Electron 28, no build step for development. `npm run hearts` regenerates
`src/hearts.js` from `assets/hearts/*.svg` and only needs running when you add
a heart shape.

## Commits

Conventional commits, lowercase, with the area in brackets:

```
feat(osc): add configurable parameter outputs
fix(mqtt): stop re-announcing the entities on every start
docs: how to trigger on game moments
```

Say in the body what was wrong and why the fix is the right one, not what the
diff already shows. Keep the subject under about 70 characters.

## Things that will be sent back

- A user-facing string in only one language
- A second writer to `settings.json` that goes around `saveStore()`, several
  handlers read and write that whole file and a stray write loses someone's data
- Changing default behaviour for people who already use the app, unless the
  pull request says so and explains why
- A new dependency for something the standard library can do. The app ships to
  end users, every package is weight and risk

## Your contribution and its license

HypeRate Desktop is source-available under the [PolyForm Shield License 1.0.0](LICENSE), and
Klickwerk.digital also sells it (on Steam, for example). By opening a pull request you agree
that Klickwerk.digital may use, change, license and sell your contribution as part of HypeRate
Desktop under any terms, including ones other than the PolyForm Shield License, and you confirm
that it is your own work. You keep the copyright in what you wrote.

If that does not work for you, say so in the pull request before it is merged.

## Not sure?

Open an issue first and ask. A short conversation beats a large pull request
that goes the wrong way.
