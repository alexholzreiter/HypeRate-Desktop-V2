// Zone colours as a gradient: for the zone bar on Live, and for the heart rate curves on Live and
// Sessions while zone colours are switched on.

import { svg } from './dom.js';

// Colour stops for the zones over the stretch lo..hi, as offsets from 0 to 1. Each colour holds
// across its zone and blends into the next over `blend` BPM on both sides of the border.
export function zoneStops(list, lo, hi, blend) {
  const at = v => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  const stops = [];
  list.forEach((z, i) => {
    const start = i === 0 ? lo : (z.min ?? lo) - 0.5;
    const end = i === list.length - 1 ? hi : (z.max ?? hi) + 0.5;
    stops.push({ offset: at(i === 0 ? start : start + blend), color: z.color });
    stops.push({ offset: at(i === list.length - 1 ? end : end - blend), color: z.color });
  });
  return stops;
}

// A gradient for an SVG curve drawn with `lo` at the bottom (y = H) and `hi` at the top (y = 0),
// so the line takes the colour of the zone it is in
export function zoneGradient(id, list, lo, hi, H, opacity = 1) {
  return svg('linearGradient', { id, gradientUnits: 'userSpaceOnUse', x1: 0, y1: H, x2: 0, y2: 0 },
    zoneStops(list, lo, hi, 2).map(st => svg('stop', { offset: st.offset.toFixed(4), 'stop-color': st.color, 'stop-opacity': opacity })));
}

// A mask that fades whatever it is put on out towards the bottom: for the area under a curve
export function fadeMask(id, W, H) {
  return [
    svg('linearGradient', { id: id + '-fade', x1: 0, y1: 0, x2: 0, y2: 1 },
      svg('stop', { offset: 0, 'stop-color': '#fff', 'stop-opacity': .8 }), svg('stop', { offset: 1, 'stop-color': '#fff', 'stop-opacity': 0 })),
    svg('mask', { id, maskContentUnits: 'userSpaceOnUse' }, svg('rect', { x: 0, y: 0, width: W, height: H, fill: `url(#${id}-fade)` })),
  ];
}
