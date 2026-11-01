import { bytesToBase64 } from './base64';
import { SLOT } from './embeddedBook';
import { collectSelfAssets } from './selfAssets';

export interface ExportInput {
  title: string;
  pdf: File;
  /**
   * 本地视频会内联字节；外链视频没法内联，只能把地址带过去
   * （打开离线文件时仍需要联网才能播它）。
   */
  video: { file: File | null; src: string; title: string } | null;
}

export type ExportStage = (stage: string) => void;

/**
 * 内联的 <script> 与 <style> 都是 raw text 元素：内容里出现对应的结束标签
 * 就会提前闭合。而这两个元素装的都是第三方产物（打包后的 JS、压缩后的 CSS），
 * 内容不由这里控制，所以两种结束序列都得打散。
 *
 * `<\/script` 与 `</script` 在 JS 里完全等价（`\/` 就是 `/`），字符串、正则、
 * 注释里都成立；`<\/style` 在 CSS 里同理。所以替换不改变任何行为，只是让
 * 浏览器不再把它认成标签结束。
 */
const CLOSING_SCRIPT = /<\/(script)/gi;
const CLOSING_STYLE = /<\/(style)/gi;

function neutralizeCloseTag(source: string, pattern: RegExp): string {
  return source.replace(pattern, '<\\/$1');
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 产物固定叫 index.html。
 *
 * 这个文件本身就是一整个网站，用户拿到后会直接放进静态托管的根目录；
 * 叫 index.html 才能让站点根路径一打开就是这本书。书名信息由 <title>
 * 承载，不靠文件名区分。
 */
const STATIC_FILE_NAME = 'index.html';

/**
 * 把应用自身 + 整本书打包成一个可以脱离服务器打开的单 HTML 文件。
 *
 * 内嵌数据都放在 type="text/plain" 的 <script> 里：HTML 解析器对该类标签
 * 走 raw text 分支，不会去解析里面的内容，比塞进大 JSON 或 JS 字符串
 * 字面量都更快，也不会踩转义问题。
 */
export async function buildSelfContainedHtml(
  input: ExportInput,
  onStage: ExportStage,
): Promise<{ html: string; fileName: string }> {
  onStage('正在读取应用自身…');
  const assets = await collectSelfAssets();

  onStage('正在读取 PDF…');
  const pdfBytes = new Uint8Array(await input.pdf.arrayBuffer());

  let videoBytes: Uint8Array | null = null;
  let videoMime = '';
  let videoUrl = '';

  if (input.video?.file) {
    onStage('正在读取视频…');
    videoBytes = new Uint8Array(await input.video.file.arrayBuffer());
    videoMime = input.video.file.type || 'video/mp4';
  } else if (input.video?.src && !input.video.src.startsWith('blob:')) {
    // 外链视频：内联不了，把地址记下来，免得视频页在离线文件里凭空消失。
    videoUrl = input.video.src;
  }

  onStage('正在编码…');
  const pdfBase64 = bytesToBase64(pdfBytes);
  const workerBase64 = bytesToBase64(assets.worker);
  const videoBase64 = videoBytes ? bytesToBase64(videoBytes) : null;

  onStage('正在拼装…');
  const meta = JSON.stringify({
    title: input.title,
    videoTitle: input.video?.title ?? '',
    videoMime,
    videoUrl,
  });

  // base64 与 JSON 里都不会出现 `<`，所以放进 script 里无需再转义。
  const slots = [
    `<script id="${SLOT.pdf}" type="text/plain">${pdfBase64}</script>`,
    `<script id="${SLOT.worker}" type="text/plain">${workerBase64}</script>`,
    videoBase64
      ? `<script id="${SLOT.video}" type="text/plain">${videoBase64}</script>`
      : '',
    `<script id="${SLOT.meta}" type="application/json">${meta}</script>`,
  ].filter(Boolean);

  const html = [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="UTF-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />',
    '<meta name="theme-color" content="#17130f" />',
    `<title>${escapeHtml(input.title)}</title>`,
    '<style>',
    neutralizeCloseTag(assets.css, CLOSING_STYLE),
    '</style>',
    '</head>',
    '<body>',
    '<div id="root"></div>',
    ...slots,
    '<script type="module">',
    neutralizeCloseTag(assets.js, CLOSING_SCRIPT),
    '</script>',
    '</body>',
    '</html>',
    '',
  ].join('\n');

  return { html, fileName: STATIC_FILE_NAME };
}
