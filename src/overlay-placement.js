// The overlay window is the widget plus a transparent margin (GLOW_PAD in the overlay, so a
// glow is never cut off). `pad` is how far that margin may hang over the screen's edge: the
// widget itself can then sit flush against the edge, and never goes past it.
const OVERLAY_PAD = 48;

function fitOverlay(area, x, y, width, height, pad = 0) {
  const w = Math.round(Math.min(area.width + 2 * pad, Math.max(40, Number(width) || 300)));
  const h = Math.round(Math.min(area.height + 2 * pad, 500, Math.max(20, Number(height) || 160)));
  return {
    x: Math.round(Math.max(area.x - pad, Math.min(x, area.x + area.width - w + pad))),
    y: Math.round(Math.max(area.y - pad, Math.min(y, area.y + area.height - h + pad))),
    width: w, height: h,
  };
}

function restoreOverlayPlacement(screen, store, width, height) {
  const primary = screen.getPrimaryDisplay();
  const legacy = Number.isFinite(store.overlayX) && Number.isFinite(store.overlayY);
  if (!Number.isInteger(store.overlayDisplayId) && legacy) {
    const { overlayX: x, overlayY: y } = store;
    const display = screen.getDisplayMatching({ x, y, width, height });
    return { display, x, y };
  }

  const preferred = screen.getAllDisplays().find(display => display.id === store.overlayDisplayId);
  const display = preferred || primary;
  const { workArea: area } = display;
  return {
    display,
    x: area.x + (preferred && Number.isFinite(store.overlayOffsetX) ? store.overlayOffsetX : area.width - width),
    y: area.y + (preferred && Number.isFinite(store.overlayOffsetY) ? store.overlayOffsetY : 20),
  };
}

function overlayPlacementPreferences(display, x, y) {
  return {
    overlayDisplayId: display.id,
    overlayOffsetX: Math.round(x - display.workArea.x),
    overlayOffsetY: Math.round(y - display.workArea.y),
    overlayX: Math.round(x),
    overlayY: Math.round(y),
  };
}

module.exports = { fitOverlay, restoreOverlayPlacement, overlayPlacementPreferences, OVERLAY_PAD };
