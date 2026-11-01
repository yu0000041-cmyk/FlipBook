export interface BookLayout {
  /** 单页宽度，像素 */
  pageWidth: number;
  /** 单页高度，像素 */
  pageHeight: number;
  /** 是否单页模式（窄屏 / 手机竖屏） */
  portrait: boolean;
}

/** 低于这个宽度就降级成单页，两页并排会小到看不清。 */
export const SPREAD_MIN_WIDTH = 880;

/**
 * 按容器可用空间和文档宽高比，算出既放得下又不变形的一页尺寸。
 * 先按高度铺满，宽度不够时再退回按宽度计算，保证两边都不越界。
 */
export function computeLayout(
  availableWidth: number,
  availableHeight: number,
  aspect: number,
): BookLayout {
  const safeAspect = Number.isFinite(aspect) && aspect > 0.1 ? aspect : 0.707;
  const portrait = availableWidth < SPREAD_MIN_WIDTH;
  const widthPerPage = portrait ? availableWidth : availableWidth / 2;

  const pageHeight = Math.max(
    160,
    Math.min(availableHeight, widthPerPage / safeAspect),
  );
  const pageWidth = pageHeight * safeAspect;

  return {
    pageWidth: Math.round(pageWidth),
    pageHeight: Math.round(pageHeight),
    portrait,
  };
}

/** 尺寸只差一两个像素时不必重建整本书。 */
export function sameLayout(a: BookLayout, b: BookLayout): boolean {
  return (
    a.portrait === b.portrait &&
    Math.abs(a.pageWidth - b.pageWidth) < 2 &&
    Math.abs(a.pageHeight - b.pageHeight) < 2
  );
}
