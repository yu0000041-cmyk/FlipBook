/**
 * 扫描 books/ 目录，生成书架清单 books/index.json。
 *
 * 用法：
 *   node tools/build-books.mjs [books目录，默认 books]
 *
 * 约定：
 *   - 每本书是 <id>.pdf，id 同时作为显示名（可用 titles.json 覆盖）
 *   - 开场视频放在同目录、同名但不同扩展名即可（<id>.mp4），自动关联
 *   - 想改显示名，在 books/titles.json 里写覆盖，不用改这个脚本
 */
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

const booksDir = process.argv[2] ?? 'books';
const VIDEO_EXTS = ['.mp4', '.webm', '.mov', '.m4v'];

let files;
try {
  files = await readdir(booksDir);
} catch {
  console.error(`目录不存在：${booksDir}`);
  process.exit(1);
}

// 可选的显示名覆盖表：{ "<id>": { "title": "中文名", "videoTitle": "开场" } }
let overrides = {};
try {
  overrides = JSON.parse(await readFile(join(booksDir, 'titles.json'), 'utf8'));
} catch {
  // 没有 titles.json 是常态，不算错误
}

const books = [];
for (const file of files) {
  if (extname(file).toLowerCase() !== '.pdf') continue;

  const id = basename(file, extname(file));
  const info = await stat(join(booksDir, file));
  const override = overrides[id] ?? {};

  // 视频两种来源：titles.json 里显式指定的优先，否则找同名文件
  // （wanbei.pdf 配 wanbei.mp4）。留显式指定是为了兼容“PDF 和视频
  // 不同名”的情况，不必为了这个去改文件名。
  const explicit = typeof override.video === 'string' ? override.video : null;
  const video =
    explicit && files.includes(explicit)
      ? explicit
      : VIDEO_EXTS.map((ext) => id + ext).find((name) => files.includes(name));

  const entry = {
    id,
    title: typeof override.title === 'string' ? override.title : id,
    size: info.size,
  };
  if (video) {
    entry.video = video;
  } else if (explicit) {
    console.warn(`  ！${id}：titles.json 指定的视频 ${explicit} 不存在，已跳过`);
  }
  if (typeof override.videoTitle === 'string') entry.videoTitle = override.videoTitle;

  books.push(entry);
}

// 顺序稳定；中文用 zh 排序才有意义
books.sort((a, b) => a.title.localeCompare(b.title, 'zh'));

const payload = JSON.stringify({ books }, null, 2) + '\n';
await writeFile(join(booksDir, 'index.json'), payload, 'utf8');

console.log(`已生成 ${join(booksDir, 'index.json')}`);
for (const book of books) {
  const video = book.video ? `  + 视频 ${book.video}` : '';
  console.log(
    `  ${book.id.padEnd(20)} ${(book.size / 1048576).toFixed(1)} MB${video}`,
  );
}
if (books.length === 0) {
  console.log('  （books/ 里还没有 PDF）');
}
