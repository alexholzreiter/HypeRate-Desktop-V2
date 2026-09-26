# Heart styles

One `.svg` per heart style. The file name is the style's id, the one stored in the user's
settings, so renaming a file resets that user's choice. Labels for the settings dropdown live
in `LABELS` in `tools/build-hearts.js`; a file that is not listed there falls back to its file
name in sentence case.

These files are build inputs. `npm run hearts` inlines them into `src/hearts.js`, which the
overlay and the settings preview both read, and only that generated file ships in the app.
The markup has to be in the document rather than in an `<img>`, because the colour picker and
the heart rate zones recolour it through `currentColor`.

## What a file needs

- **A `viewBox`.** Without it the build fails: the shape could not be scaled to the chosen size.
- **No `width` / `height`.** Stripped by the build; the size comes from the settings slider.
- **One colour.** Every fill is rewritten to `currentColor`, so a deliberately multi-coloured
  heart comes out flat. `fill="none"` is left alone, since it is a real instruction.
- **Paths, not text or embedded images.** `<text>` needs fonts that are not there, and a raster
  image cannot be recoloured.

`<style>` blocks, gradients and filters survive the build but the colour setting will not reach
them. The build prints a warning for each. Flatten them in your editor first.

## Adding one

```bash
npm run hearts
```

Commit the `.svg` and the regenerated `src/hearts.js` together.
