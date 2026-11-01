import * as pdfjs from 'pdfjs-dist';

export interface SelfAssets {
  /** 打包后的应用脚本源码 */
  js: string;
  /** 打包后的样式表源码 */
  css: string;
  /** pdf.js 的 worker 字节 */
  worker: Uint8Array;
}

/**
 * 构建产物里入口长这样：<script type="module" crossorigin src="./assets/index-xxx.js">
 *
 * dev 模式下 Vite 会额外注入 /@vite/client（以及 /src/main.tsx 这类模块入口），
 * 它们都不是「一个可内联的文件」，必须排除掉，否则会把 HMR 客户端当成
 * 应用源码打包进离线文件。
 */
function findEntryScript(): HTMLScriptElement | null {
  const scripts =
    document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]');

  for (const el of scripts) {
    const src = el.getAttribute('src') ?? '';
    if (src.includes('/@vite/') || src.includes('/@react-refresh')) continue;
    if (src.includes('/src/')) continue;
    return el;
  }

  return null;
}

function findStyleLink(): HTMLLinkElement | null {
  return document.querySelector<HTMLLinkElement>('link[rel="stylesheet"][href]');
}

/**
 * 导出离线单文件必须先跑过构建。
 *
 * 这里直接看 import.meta.env.PROD 而不是靠 DOM 猜：dev 模式下 CSS 是
 * 由脚本注入的、根本没有 <link rel="stylesheet">，入口也不是单文件。
 */
export function canExportSelfContained(): boolean {
  if (!import.meta.env.PROD) return false;
  return Boolean(findEntryScript() && findStyleLink());
}

/**
 * 取自身资源时必须认 content-type。
 *
 * 静态服务器普遍把 404 兜底成 index.html，而且**状态码仍然是 200**。
 * 只检查 res.ok 的话，一旦入口文件名已经变了（部署了新版本、而当前
 * 标签页还开着旧的），我们就会把那份 HTML 当成 JS 内联进离线文件，
 * 生成一个能打开、却完全空白的产物，而且全程不报错。
 * 静默损坏比直接失败糟糕得多，所以这里认类型、认不出就报错。
 */
async function fetchChecked(
  url: string,
  what: string,
  expectedType: string,
): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`读取${what}失败（HTTP ${res.status}）`);

  const type = res.headers.get('content-type') ?? '';
  if (!type.includes(expectedType)) {
    throw new Error(
      `读取${what}时拿到的是「${type || '未知类型'}」而不是 ${expectedType}，` +
        `说明 ${url} 已经不存在了。刷新页面后重试即可。`,
    );
  }

  return res;
}

export async function collectSelfAssets(): Promise<SelfAssets> {
  const scriptEl = findEntryScript();
  const linkEl = findStyleLink();

  if (!scriptEl || !linkEl) {
    throw new Error(
      '导出离线文件需要在构建产物里运行（先执行 npm run build）。开发模式下入口是一张模块图，取不到可内联的单文件源码。',
    );
  }

  const workerSrc = pdfjs.GlobalWorkerOptions.workerSrc;
  if (!workerSrc) throw new Error('找不到 pdf.js 的 worker 地址');

  const [jsRes, cssRes, workerRes] = await Promise.all([
    fetchChecked(scriptEl.src, '应用脚本', 'javascript'),
    fetchChecked(linkEl.href, '样式表', 'text/css'),
    fetchChecked(workerSrc, 'PDF worker', 'javascript'),
  ]);

  const [js, css, workerBuffer] = await Promise.all([
    jsRes.text(),
    cssRes.text(),
    workerRes.arrayBuffer(),
  ]);

  return { js, css, worker: new Uint8Array(workerBuffer) };
}
