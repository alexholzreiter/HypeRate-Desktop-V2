const assert = require('node:assert/strict');
const { fitOverlay, restoreOverlayPlacement, overlayPlacementPreferences } = require('../src/overlay-placement');

const main = { id: 1, scaleFactor: 2, workArea: { x: 0, y: 38, width: 1440, height: 850 } };
const left = { id: 2, scaleFactor: 1, workArea: { x: -1920, y: -90, width: 1920, height: 1040 } };
let displays = [main, left];
const screen = {
  getPrimaryDisplay: () => main,
  getAllDisplays: () => displays,
  getDisplayMatching: ({ x }) => x < 0 && displays.includes(left) ? left : main,
};
function check(name, test) {
  test();
  console.log('PASS ' + name);
}

check('first launch includes the primary work-area offset', () => {
  const placement = restoreOverlayPlacement(screen, {}, 300, 160);
  assert.deepEqual(placement, { display: main, x: 1140, y: 58 });
});

check('old coordinates restore on a display left of the primary display', () => {
  assert.deepEqual(restoreOverlayPlacement(screen, { overlayX: -400, overlayY: 25 }, 300, 160),
    { display: left, x: -400, y: 25 });
});

check('a growing and shrinking card stays on the secondary display', () => {
  const store = overlayPlacementPreferences(left, -170, 825);
  const { display, x, y } = restoreOverlayPlacement(screen, store, 160, 50);
  assert.equal(display.id, 2);
  assert.deepEqual(fitOverlay(display.workArea, x, y, 720, 280), { x: -720, y: 670, width: 720, height: 280 });
  assert.deepEqual(fitOverlay(display.workArea, x, y, 160, 50), { x: -170, y: 825, width: 160, height: 50 });
});

check('a disconnected preferred display falls back and restores on reconnection', () => {
  const store = overlayPlacementPreferences(left, -1810, 30);
  displays = [main];
  assert.deepEqual(restoreOverlayPlacement(screen, store, 300, 160), { display: main, x: 1140, y: 58 });
  displays = [main, left];
  assert.deepEqual(restoreOverlayPlacement(screen, store, 300, 160), { display: left, x: -1810, y: 30 });
});

check('relative offsets survive rearranging the secondary display', () => {
  const store = overlayPlacementPreferences(left, -1810, 30);
  const moved = { ...left, workArea: { ...left.workArea, x: 1440, y: 55 } };
  displays = [main, moved];
  assert.deepEqual(restoreOverlayPlacement(screen, store, 300, 160), { display: moved, x: 1550, y: 175 });
  displays = [main, left];
});

check('oversize overlays fit a small work area', () => {
  assert.deepEqual(fitOverlay({ x: 1440, y: -200, width: 180, height: 130 }, 1990, -500, 500, 450),
    { x: 1440, y: -200, width: 180, height: 130 });
});

check('the transparent margin may hang over the edge, the widget never does', () => {
  const area = main.workArea, pad = 48;
  // pushed far past every edge: the window stops exactly a margin beyond it
  assert.deepEqual(fitOverlay(area, -500, -500, 250, 172, pad), { x: -48, y: -10, width: 250, height: 172 });
  assert.deepEqual(fitOverlay(area, 5000, 5000, 250, 172, pad), { x: 1238, y: 764, width: 250, height: 172 });
  // a spot inside stays where it is
  assert.deepEqual(fitOverlay(area, 600, 300, 250, 172, pad), { x: 600, y: 300, width: 250, height: 172 });
  // the widget (window minus margin) touches the edges, no further
  const right = fitOverlay(area, 5000, 0, 250, 172, pad);
  assert.equal(right.x + right.width - pad, area.x + area.width);
});

