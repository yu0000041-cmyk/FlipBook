/**
 * base64 编解码。
 *
 * 这里刻意按块处理，而不是一把梭：
 * 一份 10MB 的 PDF 编码后是约 13.3MB 的字符串，一次性
 * `String.fromCharCode(...bytes)` 会因为展开参数过多直接抛
 * "too many arguments"；一次性 `atob` 也会在解码瞬间多出一个
 * 13MB 的中间字符串，把内存顶出一个很陡的尖峰。
 *
 * 按块走下来峰值只跟块大小有关，与整本书的体积无关。
 */

/** 32768：远低于各引擎的展开参数上限（约 65535），留足余量。 */
const ENCODE_CHUNK = 1 << 15;

/** 65536：必须是 4 的倍数，才能保证每块都切在 base64 四元组边界上。 */
const DECODE_CHUNK = 1 << 16;

/**
 * 精确持有的字节序列：底层保证是普通 ArrayBuffer（不是 SharedArrayBuffer），
 * 因此可以直接交给 Blob、File 或 pdf.js，不需要再做断言。
 */
export type Bytes = Uint8Array<ArrayBuffer>;

export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];

  for (let i = 0; i < bytes.length; i += ENCODE_CHUNK) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + ENCODE_CHUNK)));
  }

  return btoa(parts.join(''));
}

export function base64ToBytes(base64: string): Bytes {
  // 先探测再替换，避免为一个本来就没有空白的 13MB 字符串白白复制一份。
  const clean = /\s/.test(base64) ? base64.replace(/\s+/g, '') : base64;

  const chunks: Uint8Array[] = [];
  let total = 0;

  for (let i = 0; i < clean.length; i += DECODE_CHUNK) {
    let binary: string;
    try {
      binary = atob(clean.slice(i, i + DECODE_CHUNK));
    } catch {
      throw new Error('内嵌的 PDF 数据已损坏，无法解码');
    }

    const arr = new Uint8Array(binary.length);
    for (let j = 0; j < binary.length; j += 1) arr[j] = binary.charCodeAt(j);

    chunks.push(arr);
    total += arr.length;
  }

  const out = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** 人类可读的体积，用于导出前的提示。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
