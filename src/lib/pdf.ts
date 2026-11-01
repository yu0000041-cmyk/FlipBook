import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Vite 会把 worker 作为独立资源打包，这里把它的 URL 交给 pdf.js。
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfDoc = PDFDocumentProxy;

/** 渲染一页时希望达到的像素宽度上限，避免 4K 屏上渲染出巨图。 */
const MAX_RENDER_WIDTH = 2200;

export interface PdfHandle {
  doc: PdfDoc;
  /**
   * pdfjs v6 的 PDFDocumentProxy 上已经没有 destroy 了，
   * 释放 worker 与传输层的唯一入口是打开时拿到的 loadingTask。
   */
  close: () => Promise<void>;
}

export async function openPdf(data: ArrayBuffer): Promise<PdfHandle> {
  // 注意：pdf.js 会接管并 detach 这个 ArrayBuffer。调用方如果之后还要
  // 原始字节（例如导出离线单文件），请自己留着 File 或另外拷贝一份。
  const loadingTask = pdfjs.getDocument({ data });
  const doc = await loadingTask.promise;

  return {
    doc,
    close: () => loadingTask.destroy(),
  };
}

export interface PdfMeta {
  pageCount: number;
  aspect: number;
  title: string | null;
}

export async function readPdfMeta(doc: PdfDoc): Promise<PdfMeta> {
  const first = await doc.getPage(1);
  const viewport = first.getViewport({ scale: 1 });

  let title: string | null = null;
  try {
    const meta = await doc.getMetadata();
    const info = meta.info as { Title?: unknown } | undefined;
    if (typeof info?.Title === 'string' && info.Title.trim()) {
      title = info.Title.trim();
    }
  } catch {
    // 缺少元数据不影响阅读，用文件名兜底
  }

  return {
    pageCount: doc.numPages,
    aspect: viewport.width / viewport.height,
    title,
  };
}

export interface RenderHandle {
  promise: Promise<Blob>;
  cancel: () => void;
}

/**
 * 把某一页渲染成图片 Blob。
 *
 * 返回句柄而不是 Promise，是为了让调用方在用户快速翻页时能取消上一次渲染，
 * 否则 pdf.js 会为了一个已经翻过去的页面白烧 CPU。
 */
export function renderPdfPage(
  doc: PdfDoc,
  pageNumber: number,
  cssWidth: number,
  pixelRatio: number,
): RenderHandle {
  let cancelled = false;
  let renderTask: ReturnType<PDFPageProxy['render']> | null = null;

  const promise = (async (): Promise<Blob> => {
    const page = await doc.getPage(pageNumber);
    if (cancelled) throw new DOMException('渲染已取消', 'AbortError');

    const base = page.getViewport({ scale: 1 });
    const targetWidth = Math.min(cssWidth * pixelRatio, MAX_RENDER_WIDTH);
    const viewport = page.getViewport({ scale: targetWidth / base.width });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));

    // v6 的 RenderParameters 要求传 canvas 本身；不给 canvasContext 时
    // pdf.js 会自己铺白底，省掉一次手动的 clearRect。
    renderTask = page.render({ canvas, viewport });
    await renderTask.promise;
    page.cleanup();

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/webp', 0.92);
    });

    // 立刻释放位图，几十页渲染下来这块内存相当可观。
    canvas.width = 0;
    canvas.height = 0;

    if (!blob) throw new Error(`第 ${pageNumber} 页编码失败`);
    return blob;
  })();

  return {
    promise,
    cancel: () => {
      cancelled = true;
      renderTask?.cancel();
    },
  };
}

export interface OutlineNode {
  title: string;
  /** 1-based 页码；换算不出来时是 null（条目仍然显示，只是点不动） */
  pageNumber: number | null;
  children: OutlineNode[];
}

/**
 * 读 PDF 内嵌的书签（也就是目录）。
 *
 * 书签的目标有两种形态：命名 dest（字符串）和显式数组，两者都得经
 * getPageIndex 才能换算成页码。任何一条解析失败都只影响它自己——
 * 目录标题本身对读者就有价值，不该因为一个坏条目整棵树都不显示。
 */
export async function readPdfOutline(doc: PdfDoc): Promise<OutlineNode[]> {
  let raw: Awaited<ReturnType<PdfDoc['getOutline']>>;
  try {
    raw = await doc.getOutline();
  } catch {
    return [];
  }
  if (!raw || raw.length === 0) return [];

  const toPageNumber = async (
    dest: string | unknown[] | null | undefined,
  ): Promise<number | null> => {
    if (dest == null) return null;
    try {
      const resolved =
        typeof dest === 'string' ? await doc.getDestination(dest) : dest;
      if (!Array.isArray(resolved) || resolved.length === 0) return null;
      const index = await doc.getPageIndex(resolved[0]);
      return index + 1;
    } catch {
      return null;
    }
  };

  const walk = async (
    items: NonNullable<typeof raw>,
  ): Promise<OutlineNode[]> => {
    const out: OutlineNode[] = [];
    for (const item of items) {
      out.push({
        title: typeof item.title === 'string' ? item.title : '',
        pageNumber: await toPageNumber(item.dest),
        children: item.items && item.items.length ? await walk(item.items) : [],
      });
    }
    return out;
  };

  return walk(raw);
}
