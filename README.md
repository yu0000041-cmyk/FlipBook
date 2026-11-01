# 翻页电子书

把 PDF 变成一本能在浏览器里"翻"的书 —— 3D 翻页、目录导航、缩略图、开场视频，电脑和手机都能读。

纯前端项目，零后端、零数据库。产物是一堆静态文件，扔到任何静态托管上就能用。

## 功能

- **3D 翻页** —— 真实的 `rotateY` 翻转 + 阴影，支持拖拽、点击、方向键和底部按钮
- **响应式** —— 宽屏双页跨屏，窄屏自动切单页
- **目录导航** —— 直接读 PDF 内嵌书签，支持层级和跳页
- **缩略图** —— 按可视区懒渲染，几百页也不卡
- **开场视频** —— 书本第一页放一段 MP4，点开即播
- **按需渲染** —— 只渲染当前页 ±2 页，大文档也能秒开
- **导出** —— 可把整本书（含视频）打包成一个离线 HTML，双击就能看

## 两种用法

**① 直接在网页上用（最简单）**

打开部署好的网址 → 把 PDF 拖进去 → 点「生成书本」。
文件全程留在你自己的浏览器里，不会上传到任何服务器。
这条路径**不需要碰代码、不需要构建**。

**② 把它当成自己的书架**

如果你有固定的几本书要长期展示，把它们放进 `books/` 并构建部署，
访问根路径就是书架。详见下面「加一本你的书」。

> 仓库里的 `books/` 是空的，这是故意的——书稿属于版权内容，不该进 Git。

## 快速开始

```bash
npm install
npm run dev        # 开发模式
npm run build      # 产出 dist/
npm run preview    # 预览构建结果
```

## 加一本你的书

**1.** 把 PDF 放进 `books/`，文件名就是它的 id：

```
books/
  我的书.pdf
  我的书.mp4        # 可选，同名即自动关联为开场视频
```

**2.** 生成书架清单：

```bash
node tools/build-books.mjs books
```

**3.** `npm run build`，然后打开 `dist/`。

访问 `/?book=我的书` 直接打开这一本。书架里只有一本书时，根路径 `/` 会直接打开它。

### 自定义书名 / 视频不同名

新建 `books/titles.json`（可选，脚本不会覆盖它）：

```json
{
  "我的书": {
    "title": "显示用的书名",
    "video": "开了个好头.mp4",
    "videoTitle": "开场视频"
  }
}
```

## 部署

`npm run build` 产出的 `dist/` 是纯静态文件，和 `books/` 一起上传即可：

```
/var/www/book/
  index.html
  assets/
  books/
```

nginx 最小配置：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    root /var/www/book;
    index index.html;

    location / { try_files $uri $uri/ /index.html; }

    location /books/ {
        add_header Accept-Ranges bytes;
    }

    location /assets/ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

> **换书后看不到新内容怎么办？** PDF 文件名通常不变，URL 也就没变，浏览器会一直吃缓存。所以前端把文件体积当作版本号带上（`books/x.pdf?v=23347941`），换书后体积一变、URL 跟着变，缓存自然失效。前提是换书后重新跑过 `node tools/build-books.mjs books`。

## 技术栈

| 层 | 技术 |
|---|---|
| 构建 | Vite + TypeScript |
| UI | React |
| PDF 渲染 | pdfjs-dist（在 Web Worker 里逐页渲染成 WebP） |
| 翻页 | page-flip（StPageFlip） |

## 目录结构

```
src/
  App.tsx              应用状态机（书架 / 阅读 / 上传）
  components/
    FlipBook.tsx       翻页书，命令式接管书页 DOM
    ReaderPanel.tsx    目录 / 缩略图抽屉
    Bookshelf.tsx      书架
    UploadScreen.tsx   上传界面
  lib/
    pdf.ts             PDF 打开、书签解析、逐页渲染
    library.ts         书架清单与按需取书
    layout.ts          书页尺寸计算
    blobCache.ts       页面图片的 LRU 缓存
    exportBook.ts      导出离线单文件
tools/
  build-books.mjs      扫描 books/ 生成 index.json
books/                 放你的 PDF（内容不进仓库）
```

## 已知限制

- **不支持 Word 文档** —— 请先在 Word / WPS 里另存为 PDF。浏览器内转 PDF 需要下载几百 MB 的转换引擎，手机端基本跑不动
- **目录依赖 PDF 自带书签** —— Word 导出的 PDF 通常没有；没有时会自动退回缩略图导航
- **导出离线文件需要构建产物** —— `npm run dev` 下入口是模块图、CSS 也是脚本注入的，取不到可内联的单文件，所以该功能只在 `npm run preview` 或部署后可用
- **主包约 700 kB**（pdf.js + page-flip），未做代码分割

## License

MIT
