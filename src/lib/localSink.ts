export interface SinkResult {
  path: string;
  bytes: number;
}

/**
 * 让本地服务把导出产物直接写进固定目录（默认 video/index.html）。
 *
 * 浏览器不允许把下载落到指定的绝对路径，所以这件事只能由本地服务代劳。
 * 返回 null 表示这个接口不存在或不可用——部署到静态托管后就是这种情况，
 * 调用方应当回退成普通下载。
 */
export async function saveViaLocalSink(blob: Blob): Promise<SinkResult | null> {
  try {
    const res = await fetch('/__save-export', { method: 'POST', body: blob });
    if (!res.ok) return null;

    const data = (await res.json()) as Partial<SinkResult> & { ok?: boolean };
    if (data?.ok !== true || typeof data.path !== 'string') return null;

    return { path: data.path, bytes: typeof data.bytes === 'number' ? data.bytes : blob.size };
  } catch {
    // 网络层失败、接口 404、被 CSP 拦下……都当作「没有这个能力」
    return null;
  }
}
