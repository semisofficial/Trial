const DEFAULT_BOTTOM_PX = 20;

export function floatingCartPlacement(footerVisible, footerHeight, gap = DEFAULT_BOTTOM_PX) {
  if (!footerVisible) return { position: "fixed", bottom: DEFAULT_BOTTOM_PX };
  const safeFooterHeight = Number.isFinite(footerHeight) ? Math.max(0, footerHeight) : 0;
  return { position: "absolute", bottom: safeFooterHeight + gap };
}
