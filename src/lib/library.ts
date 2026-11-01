export interface LibraryEntry {
  id: string;
  title: string;
  /** 封面图，相对 books/ 的路径；可选 */
  cover?: string;
  /** 开场视频文件名（相对 books/）；有就放在第一页 */
  video?: string;
  /** 视频页标题；不填则用“开场视频” */
  videoTitle?: string;
  pages?: number;
  size?: number;
}

export interface FetchedBook {
  data: ArrayBuffer;
  title: string;
}

/** 从 URL 读 ?book=<id>；没有就返回 null。 */
export function readBookId(): string | null {
  if (typeof window === 'undefined') return null;
  const raw = new URLSearchParams(window.location.search).get('book');
  const id = raw?.trim();
  return id ? id : null;
}

/**
 * 读书架清单 books/index.json。
 *
 * 两个必须防的点：
 * 1) 静态服务器常把 404 兜底成 index.html、状态码还是 200，所以认 content-type，
 *    不然会把一份 HTML 当 JSON 解析；
 * 2) 整个站点被 file:// 直接打开时 fetch 会失败，这时返回 null，
 *    调用方据此回退到上传界面。
 */
export async function fetchLibrary(): Promise<LibraryEntry[] | null> {
  try {
    const res = await fetch('books/index.json', { cache: 'no-cache' });
    if (!res.ok) return null;

    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('json')) return null;

    const data = (await res.json()) as { books?: unknown };
    if (!data || !Array.isArray(data.books)) return null;

    return data.books.filter(
      (item): item is LibraryEntry =>
        Boolean(item) &&
        typeof (item as LibraryEntry).id === 'string' &&
        (item as LibraryEntry).id.length > 0,
    );
  } catch {
    return null;
  }
}

/** 取某本书的 PDF 字节。同样认 content-type，避免把兜底的 HTML 当成 PDF。 */
export async function fetchBookPdf(entry: LibraryEntry): Promise<FetchedBook> {
  const id = encodeURIComponent(entry.id);
  // 带上体积当版本号：书的文件名通常不变，内容换了 URL 也必须跟着变，
  // 否则浏览器会一直吃本地缓存（nginx 的缓存头不一定靠得住）。
  const version = entry.size ? `?v=${entry.size}` : '';
  const res = await fetch(`books/${id}.pdf${version}`);
  if (!res.ok) throw new Error(`打不开这本书（HTTP ${res.status}）`);

  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('pdf') && !type.includes('octet-stream')) {
    throw new Error(
      `books/${entry.id}.pdf 没找到——服务器返回的是「${type || '未知类型'}」而不是 PDF。`,
    );
  }

  return {
    data: await res.arrayBuffer(),
    title: entry.title || entry.id,
  };
}
