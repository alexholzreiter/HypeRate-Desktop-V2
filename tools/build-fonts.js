// Regenerates assets/fonts from the @fontsource packages (fetch them into a scratch folder
// first: npm pack @fontsource/space-mono @fontsource/dm-sans @fontsource/playfair-display
// @fontsource/bebas-neue @fontsource/vt323, then untar each into a folder of the same name).
//   node tools/build-fonts.js <folder with the unpacked packages> assets/fonts
const fs = require('fs');
const path = require('path');
const PKGS = process.argv[2];
const OUT = process.argv[3];
const WANT = {
  'space-mono': [400, 700],
  'dm-sans': [300, 400, 500, 600],
  'playfair-display': [700],
  'bebas-neue': [400],
  'vt323': [400],
};
fs.mkdirSync(OUT, { recursive: true });
let css = '/* Fonts shipped with HypeRate Desktop (SIL Open Font License 1.1, see the LICENSE-*.txt files\n   next to this one). Generated from the @fontsource packages; latin and latin-ext only. */\n';
for (const [name, weights] of Object.entries(WANT)) {
  const dir = fs.readdirSync(PKGS).find(d => d.startsWith('fontsource-' + name + '-') && !d.endsWith('.tgz'));
  const pkg = path.join(PKGS, dir, 'package');
  fs.copyFileSync(path.join(pkg, 'LICENSE'), path.join(OUT, `LICENSE-${name}.txt`));
  for (const w of weights) {
    const src = fs.readFileSync(path.join(pkg, `${w}.css`), 'utf8');
    for (const block of src.split(/\n(?=\/\*)/)) {
      const m = block.match(/\/\* ([a-z0-9-]+-(latin|latin-ext)-\d+-normal) \*\//);
      if (!m) continue;
      const file = m[1] + '.woff2';
      fs.copyFileSync(path.join(pkg, 'files', file), path.join(OUT, file));
      css += '\n' + block.trim()
        .replace(/src: url\([^;]+;/, `src: url(./${file}) format('woff2');`) + '\n';
    }
  }
}
fs.writeFileSync(path.join(OUT, 'fonts.css'), css);
console.log(fs.readdirSync(OUT).length, 'files,', (fs.readdirSync(OUT).reduce((n, f) => n + fs.statSync(path.join(OUT, f)).size, 0) / 1024).toFixed(0), 'KB');
