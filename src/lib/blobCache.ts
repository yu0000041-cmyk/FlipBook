interface CacheEntry {
  url: string;
  bytes: number;
}

/**
 * 已渲染书页的 Blob URL 缓存。
 *
 * PDF 页渲染结果是图片 Blob，全留在大文档上会吃掉几百 MB，
 * 全丢掉又会让来回翻页反复重渲染。所以按总字节数设上限，
 * 超出后从最久未使用的页开始 revoke。
 */
export class BlobCache {
  private readonly entries = new Map<number, CacheEntry>();
  private readonly maxBytes: number;
  private bytes = 0;

  constructor(maxBytes = 180 * 1024 * 1024) {
    this.maxBytes = maxBytes;
  }

  has(key: number): boolean {
    return this.entries.has(key);
  }

  get(key: number): string | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;

    // 重新插入一次，把这一页挪到 LRU 队列末尾。
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit.url;
  }

  put(key: number, blob: Blob): string {
    this.delete(key);

    const entry: CacheEntry = { url: URL.createObjectURL(blob), bytes: blob.size };
    this.entries.set(key, entry);
    this.bytes += entry.bytes;
    this.evict();

    return entry.url;
  }

  delete(key: number): void {
    const hit = this.entries.get(key);
    if (!hit) return;

    URL.revokeObjectURL(hit.url);
    this.entries.delete(key);
    this.bytes -= hit.bytes;
  }

  clear(): void {
    for (const entry of this.entries.values()) URL.revokeObjectURL(entry.url);
    this.entries.clear();
    this.bytes = 0;
  }

  /** 当前页附近是「正在看」的页，回收时优先跳过它们。 */
  private evict(protect?: (key: number) => boolean): void {
    if (this.bytes <= this.maxBytes) return;

    for (const key of [...this.entries.keys()]) {
      if (this.bytes <= this.maxBytes) return;
      if (protect?.(key)) continue;
      this.delete(key);
    }
  }
}
