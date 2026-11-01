import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PageFlip } from 'page-flip/dist/js/page-flip.module.js';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { readPdfOutline, renderPdfPage } from '../lib/pdf';
import type { OutlineNode } from '../lib/pdf';
import ReaderPanel from './ReaderPanel';
import type { RenderHandle } from '../lib/pdf';
import { BlobCache } from '../lib/blobCache';
import { computeLayout, sameLayout } from '../lib/layout';
import type { BookLayout } from '../lib/layout';
import type { BookData, BookPage } from '../lib/types';

/** pdf.js 在单线程 worker 上排队，同时开两个已经够填满网络与解码间隙。 */
const MAX_CONCURRENT_RENDERS = 2;
const LOOKAHEAD_PAGES = 2;
const LOOKBEHIND_PAGES = 1;

interface MutableBox<T> {
  current: T;
}

interface FlipBookProps {
  book: BookData;
  doc: PDFDocumentProxy;
  onClose: () => void;
  /** 为 null 表示这本书不能导出（例如它本身就是从离线文件打开的） */
  onExport: (() => void) | null;
  /** 导出/结果提示文字 */
  exportNote: string | null;
  exportBusy: boolean;
  /** 预估产物体积，仅作提示 */
  exportEstimate: string | null;
  /**
   * 导出完成后的手动下载入口。
   * 自动下载可能被浏览器策略静默拦下，所以必须留一条点得到的数据出口。
   */
  exportDownload: { url: string; fileName: string } | null;
}

interface RenderJob {
  index: number;
  pageNumber: number;
}

function buildVideoPage(
  page: Extract<BookPage, { kind: 'video' }>,
  videoBox: MutableBox<HTMLVideoElement | null>,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'video-page';

  const video = document.createElement('video');
  video.className = 'video-page__player';
  video.src = page.src;
  video.controls = true;
  video.preload = 'metadata';
  video.playsInline = true;
  // iOS 上必须同时给属性，只设 JS 属性在部分版本里仍会强制全屏。
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  videoBox.current = video;

  // page-flip 默认「点书页就翻页」，点播放按钮的事件会冒泡上去把书翻走。
  // 只在 video 和 poster 自身上拦，视频页的空白处仍然可以点击翻页。
  const stopBubble = (event: Event) => event.stopPropagation();
  const BUBBLE_TYPES = ['pointerdown', 'mousedown', 'touchstart', 'click'];
  // video 默认是藏着的，用户实际点的是下面的 poster 遮罩，
  // 所以两边都要拦：只拦 click 不够，page-flip 看的是 mousedown/touchstart。
  for (const type of BUBBLE_TYPES) {
    video.addEventListener(type, stopBubble);
  }

  const poster = document.createElement('button');
  poster.type = 'button';
  poster.className = 'video-page__poster';
  poster.setAttribute('aria-label', '播放视频');
  poster.innerHTML =
    '<span class="video-page__play" aria-hidden="true"></span>' +
    '<span class="video-page__cta">点击播放</span>';

  for (const type of BUBBLE_TYPES) {
    poster.addEventListener(type, stopBubble);
  }

  poster.addEventListener('click', (event) => {
    event.stopPropagation();
    poster.classList.add('is-hidden');
    // 点了播放才把 video 显出来（未播放时它是整块黑帧）
    video.classList.add('is-active');
    void video.play().catch(() => {
      poster.classList.remove('is-hidden');
    });
  });

  const caption = document.createElement('p');
  caption.className = 'video-page__caption';
  caption.textContent = page.title;

  wrap.append(caption, video, poster);
  return wrap;
}

function buildPage(
  page: BookPage,
  index: number,
  videoBox: MutableBox<HTMLVideoElement | null>,
  images: Map<number, HTMLImageElement>,
): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'book-page';
  el.dataset.index = String(index);

  if (page.kind === 'video') {
    el.classList.add('book-page--video');
    el.appendChild(buildVideoPage(page, videoBox));
    return el;
  }

  const img = document.createElement('img');
  img.className = 'book-page__img';
  img.alt = `第 ${page.pageNumber} 页`;
  img.draggable = false;
  img.decoding = 'async';
  images.set(index, img);

  const skeleton = document.createElement('div');
  skeleton.className = 'book-page__skeleton';
  skeleton.setAttribute('aria-hidden', 'true');
  skeleton.textContent = String(page.pageNumber);

  el.append(img, skeleton);
  return el;
}

export default function FlipBook({
  book,
  doc,
  onClose,
  onExport,
  exportNote,
  exportBusy,
  exportEstimate,
  exportDownload,
}: FlipBookProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);

  const flipRef = useRef<PageFlip | null>(null);
  const cacheRef = useRef(new BlobCache());
  const layoutRef = useRef<BookLayout | null>(null);
  const savedIndexRef = useRef(0);
  const disposedRef = useRef(false);

  const [layout, setLayout] = useState<BookLayout | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [outline, setOutline] = useState<OutlineNode[]>([]);
  const [outlineLoading, setOutlineLoading] = useState(false);

  const totalPages = book.pages.length;

  // 视频页占据第 0 个位置，所以 PDF 页码和书页下标之间要差一个偏移。
  const videoOffset = book.pages.some((page) => page.kind === 'video') ? 1 : 0;

  useEffect(() => {
    let cancelled = false;
    setOutlineLoading(true);
    readPdfOutline(doc)
      .then((nodes) => {
        if (cancelled) return;
        setOutline(nodes);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setOutlineLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [doc]);

  // 先同步量一次，避免等 ResizeObserver 的防抖而看到空屏。
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const rect = stage.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setLayout(computeLayout(rect.width, rect.height, book.aspect));
    }
  }, [book.aspect]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    let timer = 0;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;

      const { width, height } = entry.contentRect;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const next = computeLayout(width, height, book.aspect);
        setLayout((prev) => (prev && sameLayout(prev, next) ? prev : next));
      }, 140);
    });

    observer.observe(stage);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [book.aspect]);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    const host = hostRef.current;
    const activeLayout = layout;
    if (!stage || !host || !activeLayout) return;

    // page-flip 的 destroy() 是照 element.parentElement 把挂载点摘下来的，
    // 而 React 并不知道节点被移走了、不会补回来。StrictMode 的二次挂载和每次
    // resize 重建都会走到这里，所以重建前必须自己把挂载点接回舞台。
    if (host.parentElement !== stage) stage.appendChild(host);

    disposedRef.current = false;

    // 页面尺寸变化太大时，旧图会明显发虚，不如丢弃重新渲染。
    const previousWidth = layoutRef.current?.pageWidth ?? 0;
    if (
      previousWidth > 0 &&
      Math.abs(previousWidth - activeLayout.pageWidth) / previousWidth > 0.25
    ) {
      cacheRef.current.clear();
    }
    layoutRef.current = activeLayout;

    // page-flip 会接管并重排这些节点，所以整棵书页 DOM 由这里手工管理，
    // React 只负责渲染空的挂载点。
    host.innerHTML = '';
    const images = new Map<number, HTMLImageElement>();
    const videoBox: MutableBox<HTMLVideoElement | null> = { current: null };
    const pending = new Map<number, RenderHandle>();
    const queue: RenderJob[] = [];

    const videoIndex = book.pages.findIndex((page) => page.kind === 'video');

    const pauseVideo = () => {
      const video = videoBox.current;
      if (video && !video.paused) video.pause();
    };

    const paint = (index: number) => {
      const url = cacheRef.current.get(index);
      const img = images.get(index);
      if (!url || !img || img.dataset.src === url) return;

      img.dataset.src = url;
      img.addEventListener('load', () => img.classList.add('is-ready'), { once: true });
      img.src = url;
    };

    const markFailed = (index: number) => {
      const img = images.get(index);
      if (!img) return;
      img.classList.add('is-failed');
      const skeleton = img.parentElement?.querySelector('.book-page__skeleton');
      if (skeleton) {
        skeleton.textContent = '这一页渲染失败';
        skeleton.classList.add('is-error');
      }
    };

    const pump = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = (layoutRef.current?.pageWidth ?? 640) * dpr;

      while (queue.length > 0 && pending.size < MAX_CONCURRENT_RENDERS) {
        const job = queue.shift();
        if (!job) break;

        const handle = renderPdfPage(doc, job.pageNumber, width, dpr);
        pending.set(job.index, handle);

        handle.promise
          .then((blob) => {
            pending.delete(job.index);
            if (disposedRef.current) return;
            cacheRef.current.put(job.index, blob);
            paint(job.index);
            pump();
          })
          .catch((error: unknown) => {
            pending.delete(job.index);
            if ((error as Error)?.name === 'AbortError') return;
            console.error(`第 ${job.pageNumber} 页渲染失败`, error);
            markFailed(job.index);
            pump();
          });
      }
    };

    const schedule = (center: number) => {
      for (let i = center - LOOKBEHIND_PAGES; i <= center + LOOKAHEAD_PAGES; i += 1) {
        if (i < 0 || i >= book.pages.length) continue;

        const page = book.pages[i];
        if (page.kind !== 'pdf') continue;

        if (cacheRef.current.has(i)) {
          paint(i);
          continue;
        }
        if (pending.has(i) || queue.some((job) => job.index === i)) continue;

        queue.push({ index: i, pageNumber: page.pageNumber });
      }
      pump();
    };

    const elements = book.pages.map((page, index) => {
      const el = buildPage(page, index, videoBox, images);
      host.appendChild(el);
      return el;
    });

    const flip = new PageFlip(host, {
      width: activeLayout.pageWidth,
      height: activeLayout.pageHeight,
      size: 'fixed',
      // page-flip 自带的横竖屏判定用的是 block 元素当下的实测宽度，
      // 而那个宽度又取决于上一次布局，宽屏下会自我锁定在单页。
      // 版面已经由 computeLayout 定好了，这里直接把结论交给它。
      usePortrait: activeLayout.portrait,
      // 封面（第一页）单独显示。page-flip 会把它放在右半屏，
      // 我们在 CSS 里用 .is-cover 把它挪到正中。
      showCover: true,
      // 关掉 page-flip 自带的逐帧 canvas 阴影——翻页卡顿的主要来源。
      // 立体感改用 CSS 静态阴影补偿，开销小一两个数量级。
      drawShadow: false,
      // 略短一点，翻页更跟手（原来 750ms 显得拖沓）。
      flippingTime: 620,
      maxShadowOpacity: 0,
      mobileScrollSupport: true,
      swipeDistance: 18,
      showPageCorners: true,
      disableFlipByClick: false,
      autoSize: false,
      clickEventForward: true,
      useMouseEvents: true,
    });

    flip.loadFromHTML(elements);
    flipRef.current = flip;


    flip.on('flip', (event) => {
      const index = event.data;
      setCurrentPage(index);
      savedIndexRef.current = index;

      // 翻走以后视频必须停下来，否则声音会跟着书页一起翻过去。
      if (videoIndex >= 0 && index !== videoIndex) pauseVideo();

      // 翻页期间把视频藏起来：<video> 在 rotateY 变换里要逐帧重新合成，
      // 是首页翻页卡顿的主因。等动画跑完再显示回来。
      const video = videoBox.current;
      if (video) {
        video.style.visibility = 'hidden';
        window.setTimeout(() => {
          video.style.visibility = '';
        }, 800);
      }
      schedule(index);
    });

    const restore = savedIndexRef.current;
    if (restore > 0 && restore < book.pages.length) {
      flip.turnToPage(restore);
      setCurrentPage(restore);
    }
    schedule(restore);

    return () => {
      disposedRef.current = true;
      savedIndexRef.current = flip.getCurrentPageIndex();

      for (const handle of pending.values()) handle.cancel();
      pending.clear();
      queue.length = 0;

      flip.off('flip');
      flip.destroy();
      flipRef.current = null;

      host.innerHTML = '';
      images.clear();
      videoBox.current = null;
    };
  }, [book, doc, layout]);

  useEffect(() => () => cacheRef.current.clear(), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') flipRef.current?.turnToNextPage();
      else if (event.key === 'ArrowLeft') flipRef.current?.turnToPrevPage();
      else if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void document.documentElement.requestFullscreen().catch(() => undefined);
    }
  };

  const jumpToPdfPage = (pageNumber: number) => {
    flipRef.current?.turnToPage(pageNumber - 1 + videoOffset);
  };

  return (
    <div className="reader">
      {panelOpen && (
        <ReaderPanel
          doc={doc}
          pageCount={book.pdfPageCount}
          currentPage={currentPage - videoOffset + 1}
          outline={outline}
          outlineLoading={outlineLoading}
          onJump={jumpToPdfPage}
          onClose={() => setPanelOpen(false)}
        />
      )}

      <div className="reader__bar">
        <button type="button" className="ghost-button" onClick={onClose}>
          ← 换一本书
        </button>
        <span className="reader__title" title={book.title}>
          {book.title}
        </span>
        <div className="reader__actions">
          <button
            type="button"
            className="ghost-button"
            onClick={() => setPanelOpen((open) => !open)}
            title="目录 / 缩略图"
          >
            目录
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => onExport?.()}
            disabled={exportBusy}
            title={
              exportEstimate
                ? `预计约 ${exportEstimate}。导出的是一个 HTML 文件，不需要任何服务器或托管。`
                : undefined
            }
          >
            {exportBusy ? (exportNote ?? '导出中…') : '导出离线文件'}
          </button>
          <button type="button" className="ghost-button" onClick={toggleFullscreen}>
            全屏
          </button>
        </div>
      </div>

      {exportNote && !exportBusy && (
        <p className="reader__notice">
          <span>{exportNote}</span>
          {exportDownload && (
            <a
              className="ghost-button"
              href={exportDownload.url}
              download={exportDownload.fileName}
            >
              没收到文件？点这里
            </a>
          )}
        </p>
      )}

      {/*
        双页模式下 page-flip 把封面（第 1 页）贴在右半，左边空一片。
        这里标个状态交给 CSS，把封面挪到正中。
        单页模式（手机）本来就居中，不需要这个类。
      */}
      <div
        className={'reader__stage' + (!layout?.portrait && currentPage === 0 ? ' is-cover' : '')}
        ref={stageRef}
      >
        <div className="reader__book" ref={hostRef} />
      </div>

      <div className="reader__bar reader__bar--footer">
        <button
          type="button"
          className="ghost-button"
          onClick={() => flipRef.current?.turnToPrevPage()}
          disabled={currentPage <= 0}
        >
          ← 上一页
        </button>
        <span className="reader__pager">
          {Math.min(currentPage + 1, totalPages)} / {totalPages}
        </span>
        <button
          type="button"
          className="ghost-button"
          onClick={() => flipRef.current?.turnToNextPage()}
          disabled={currentPage >= totalPages - 1}
        >
          下一页 →
        </button>
      </div>
    </div>
  );
}
