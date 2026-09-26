# Heart styles

Drop one `.svg` per heart style in this folder. The file name becomes the style's id and,
title-cased, its label in the settings: `pixel-heart.svg` → `pixel-heart` → "Pixel Heart".

A build step inlines these into the overlay and the settings preview, because both need the
markup in the document to recolour it. Nothing here is loaded at runtime.

## What a file needs

- **A `viewBox`.** Without it the shape cannot be scaled to the chosen heart size.
- **No `width` / `height` attributes.** The build step strips them; the size comes from the
  settings slider.
- **One colour, and it must follow the setting.** Use `fill="currentColor"`, or leave the fill
  out entirely. Hard-coded fills are rewritten to `currentColor` by the build step, so a
  deliberately multi-coloured heart will come out flat. Say so if you want one kept as is.
- **Paths, not text or embedded images.** `<text>` depends on fonts that are not there, and a
  raster image cannot be recoloured.

## What breaks the recolouring

`<style>` blocks, `<defs>` with gradients, `filter`, and `mask`. They survive the build but the
colour picker and the heart rate zones will not reach them. Flatten those in your editor first.

## Adding them

```bash
npm run hearts
```

Regenerates the shared file both windows read. Commit that file along with the SVGs.
