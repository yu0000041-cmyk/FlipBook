import * as pdfjs from 'pdfjs-dist';
import { base64ToBytes } from './base64';
import type { Bytes } from './base64';

/**
 * 导出文件里内嵌数据的容器 id。
 * 生成端（exportBook.ts）与读取端共用这几个常量，避免两边写岔。
 */
export const SLOT = {
  pdf: '__ebook_pdf',
  worker: '__ebook_worker',
  video: '__ebook_video',
  meta: '__ebook_meta',
} as const;

export interface EmbeddedVideo {
  /** 内联的视频字节；外链视频没有 */
  bytes: Bytes | null;
  /** 外链地址；内联视频没有 */
  url: string | null;
  mime: string;
  title: string;
}

export interface EmbeddedBook {
  title: string;
  pdf: Bytes;
  video: EmbeddedVideo | null;
}

interface EmbeddedMeta {
  title?: unknown;
  videoTitle?: unknown;
  videoMime?: unknown;
  videoUrl?: unknown;
}

function readSlotText(id: string): string | null {
  const el = document.getElementById(id);
  const text = el?.textContent;
  return text && text.length > 0 ? text : null;
}

export function hasEmbeddedBook(): boolean {
  return readSlotText(SLOT.pdf) !== null;
}

/**
 * 导出的离线文件里，pdf.js 的 worker 也一并内联了。
 * 这里把它还原成 blob URL 覆盖掉构建时写死的那个地址——那个地址在
 * 离线文件里指向不存在的资源，不覆盖的话 pdf.js 只能退回主线程。
 */
export function installEmbeddedWorker(): void {
  const text = readSlotText(SLOT.worker);
  if (!text) return;

  const bytes = base64ToBytes(text);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
  pdfjs.GlobalWorkerOptions.workerSrc = url;
}

/**
 * 解出内嵌的书。注意 base64ToBytes 是同步的，13MB 量级会占用主线程
 * 几百毫秒，调用方应当先把加载态渲染出来再调它。
 */
export function readEmbeddedBook(): EmbeddedBook | null {
  const pdfText = readSlotText(SLOT.pdf);
  if (!pdfText) return null;

  let meta: EmbeddedMeta = {};
  const metaText = readSlotText(SLOT.meta);
  if (metaText) {
    try {
      meta = JSON.parse(metaText) as EmbeddedMeta;
    } catch {
      // 元数据坏了不该挡住正文
    }
  }

  const videoTitle =
    typeof meta.videoTitle === 'string' && meta.videoTitle
      ? meta.videoTitle
      : '开场视频';

  const videoText = readSlotText(SLOT.video);
  const videoUrl = typeof meta.videoUrl === 'string' ? meta.videoUrl : '';

  let video: EmbeddedVideo | null = null;
  if (videoText) {
    video = {
      bytes: base64ToBytes(videoText),
      url: null,
      mime: typeof meta.videoMime === 'string' ? meta.videoMime : 'video/mp4',
      title: videoTitle,
    };
  } else if (videoUrl) {
    // 外链视频：只带回了地址，播放时仍然需要联网。
    video = { bytes: null, url: videoUrl, mime: '', title: videoTitle };
  }

  return {
    title:
      typeof meta.title === 'string' && meta.title.trim()
        ? meta.title.trim()
        : '翻页电子书',
    pdf: base64ToBytes(pdfText),
    video,
  };
}
