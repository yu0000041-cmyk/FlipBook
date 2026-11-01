/**
 * 把一段内容变成可下载的 blob URL。
 *
 * 释放（URL.revokeObjectURL）交给调用方——因为界面上那个「重新下载」
 * 链接需要它一直有效，不能下载完就撤掉。
 */
export function createDownloadUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}

/**
 * 触发一次浏览器下载。
 *
 * 注意：这一步**可能被静默拦下**（浏览器策略、企业管控、自动化环境），
 * `click()` 既不抛错也没有返回值，代码无从感知。
 * 所以调用方绝不能只靠它——必须同时给出一个可手动点击的链接，
 * 否则用户会看到「已导出」却怎么也找不到文件。
 */
export function triggerDownload(url: string, fileName: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
