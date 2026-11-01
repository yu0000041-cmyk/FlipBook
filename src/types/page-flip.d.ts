/**
 * page-flip (StPageFlip) 2.0.7 只发布编译产物，没有随包提供 .d.ts。
 * 这里按 dist/js/page-flip.module.js 的真实导出面手写声明：
 * 该文件末尾只有 `export{x as PageFlip}`，所以只暴露 PageFlip 一个值。
 */
declare module 'page-flip/dist/js/page-flip.module.js' {
  export type PageOrientation = 'portrait' | 'landscape';
  export type SizeType = 'fixed' | 'stretch';
  export type FlipCorner = 'top' | 'bottom';

  export interface FlipSetting {
    /** 书页宽度（size 为 'stretch' 时作为宽高比基准） */
    width: number;
    /** 书页高度（size 为 'stretch' 时作为宽高比基准） */
    height: number;
    size: SizeType;
    minWidth: number;
    maxWidth: number;
    minHeight: number;
    maxHeight: number;
    drawShadow: boolean;
    /** 单次翻页动画时长，毫秒 */
    flippingTime: number;
    /** 允许窄屏自动降级为单页 */
    usePortrait: boolean;
    startZIndex: number;
    autoSize: boolean;
    maxShadowOpacity: number;
    /** 首尾页单独居中显示，模拟真实书封 */
    showCover: boolean;
    mobileScrollSupport: boolean;
    /** 触发翻页的滑动距离阈值，像素 */
    swipeDistance: number;
    clickEventForward: boolean;
    useMouseEvents: boolean;
    showPageCorners: boolean;
    disableFlipByClick: boolean;
  }

  export interface FlipEvent {
    data: number;
  }

  export class PageFlip {
    constructor(element: HTMLElement, setting?: Partial<FlipSetting>);

    loadFromHTML(items: NodeListOf<HTMLElement> | HTMLElement[]): void;
    loadFromImages(images: string[]): void;
    update(): void;
    destroy(): void;

    turnToPage(page: number): void;
    turnToNextPage(): void;
    turnToPrevPage(): void;
    flipNext(corner?: FlipCorner): void;
    flipPrev(corner?: FlipCorner): void;

    getPageCount(): number;
    getCurrentPageIndex(): number;
    getOrientation(): PageOrientation;

    on(event: 'flip', callback: (e: FlipEvent) => void): void;
    on(
      event: 'changeOrientation',
      callback: (e: { data: PageOrientation }) => void,
    ): void;
    on(
      event: 'init',
      callback: (e: { data: { page: number; mode: PageOrientation } }) => void,
    ): void;
    on(event: 'changeState', callback: (e: { data: string }) => void): void;

    off(event: string): void;
  }
}
