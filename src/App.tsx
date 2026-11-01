import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Bookshelf from './components/Bookshelf';
import FlipBook from './components/FlipBook';
import UploadScreen from './components/UploadScreen';
import { formatBytes } from './lib/base64';
import { createDownloadUrl, triggerDownload } from './lib/download';
import { saveViaLocalSink } from './lib/localSink';
import { hasEmbeddedBook, readEmbeddedBook } from './lib/embeddedBook';
import { buildSelfContainedHtml } from './lib/exportBook';
import { openPdf, readPdfMeta } from './lib/pdf';
import type { PdfDoc, PdfHandle } from './lib/pdf';
import { fetchBookPdf, fetchLibrary, readBookId } from './lib/library';
import type { LibraryEntry } from './lib/library';
import { canExportSelfContained } from './lib/selfAssets';
import type { BookData, BookPage, VideoSource } from './lib/types';

type Phase =
  | { kind: 'idle' }
  | { kind: 'working'; status: string }
  | { kind: 'reading'; book: BookData; doc: PdfDoc }
  | { kind: 'failed'; message: string };

type ExportState =
  | { kind: 'idle' }
  | { kind: 'working'; stage: string }
  | { kind: 'done'; fileName: string; bytes: number; url: string; savedPath: string | null }
  | { kind: 'failed'; message: string };

interface SubmitPayload {
  pdf: File;
  video: VideoSource | null;
  videoTitle: string;
}

/** 一本书的来源，无论是刚上传的，还是从导出的离线文件里解出来的。 */
interface OpenSource {
  /** 交给 pdf.js 的字节，会被它接管并 detach */
  data: ArrayBuffer;
  title: string;
  /** 上传来的原始文件；离线文件里为 null（此时无法再次导出） */
  pdfFile: File | null;
  video: (VideoSource & { title: string }) | null;
}

/** 导出产物大约有 3.4MB 是应用自身（JS + CSS + pdf.js worker）的固定开销。 */
const SELF_OVERHEAD_ESTIMATE = 3.4 * 1024 * 1024;

export default function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [status, setStatus] = useState('正在加载…');
  const [exportState, setExportState] = useState<ExportState>({ kind: 'idle' });
  const [hasSourceFile, setHasSourceFile] = useState(false);
  /** 站点模式下的书架；为空表示这不是一个多书站点 */
  const [shelf, setShelf] = useState<LibraryEntry[] | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  /** 清单取回来后先存这儿；只有一本书时不立刻铺书架，免得闪一下 */
  const libraryRef = useRef<LibraryEntry[] | null>(null);
  /**
   * 站点模式的启动期：正在取清单、或正在加载第一本书。
   * 这段时间必须显示专门的加载画面——哪怕只渲染一帧书架或上传界面，
   * 23MB 的 PDF 加载那两三秒里用户都会看到它，像是「点开没进书」。
   */
  const [startup, setStartup] = useState(true);

  const handleRef = useRef<PdfHandle | null>(null);
  const videoRef = useRef<(VideoSource & { title: string }) | null>(null);
  /** 导出离线单文件时要重新读原始字节，所以留 File 而不是 ArrayBuffer。 */
  const pdfFileRef = useRef<File | null>(null);
  /** 上一次导出产物的 blob URL，留着给「重新下载」用，下次导出时再释放。 */
  const exportUrlRef = useRef<string | null>(null);

  /** pdf.js 的加载任务和视频 blob URL 都得显式释放，否则换着书看会一直涨内存。 */
  const releaseResources = useCallback(() => {
    const handle = handleRef.current;
    handleRef.current = null;
    if (handle) void handle.close().catch(() => undefined);

    if (videoRef.current?.revoke) URL.revokeObjectURL(videoRef.current.src);
    videoRef.current = null;
    pdfFileRef.current = null;

    if (exportUrlRef.current) URL.revokeObjectURL(exportUrlRef.current);
    exportUrlRef.current = null;
  }, []);

  useEffect(() => releaseResources, [releaseResources]);

  /**
   * 导出不可用的原因，null 表示可用。
   *
   * 按钮本身始终显示——藏起来的话使用者根本不知道有这个功能，
   * 更不知道要怎样才能用上。点一下就把原因讲清楚。
   */
  const exportBlocked = useMemo(() => {
    if (!import.meta.env.PROD) {
      return '导出需要在构建产物里运行：开发模式（npm run dev）下 Vite 不产出可内联的单文件。执行 npm run build，再用 npm run preview 或任意静态托管打开即可。';
    }
    if (!canExportSelfContained()) {
      return '找不到可内联的应用资源，导出暂不可用。';
    }
    if (!hasSourceFile) {
      return '这本书打开自离线文件，没有原始 PDF，无法再次导出。';
    }
    return null;
  }, [hasSourceFile]);

  const openFromSource = useCallback(
    async (source: OpenSource) => {
      releaseResources();
      setStatus('正在解析 PDF…');
      setPhase({ kind: 'working', status: '正在解析 PDF…' });

      try {
        const handle = await openPdf(source.data);
        handleRef.current = handle;
        pdfFileRef.current = source.pdfFile;
        setHasSourceFile(Boolean(source.pdfFile));
        if (source.video) videoRef.current = source.video;

        const meta = await readPdfMeta(handle.doc);
        if (meta.pageCount === 0) throw new Error('这份 PDF 里没有可显示的页面');

        const pages: BookPage[] = [];
        if (source.video) {
          pages.push({
            kind: 'video',
            src: source.video.src,
            title: source.video.title,
          });
        }
        for (let pageNumber = 1; pageNumber <= meta.pageCount; pageNumber += 1) {
          pages.push({ kind: 'pdf', pageNumber });
        }

        setPhase({
          kind: 'reading',
          doc: handle.doc,
          book: {
            title: meta.title ?? source.title,
            pages,
            aspect: meta.aspect,
            pdfPageCount: meta.pageCount,
          },
        });
      } catch (error) {
        console.error(error);
        releaseResources();
        setHasSourceFile(false);
        setPhase({
          kind: 'failed',
          message:
            error instanceof Error ? error.message : '打开失败，请确认这是一份有效的 PDF',
        });
      }
    },
    [releaseResources],
  );

  /** 按书架清单里的一个条目打开：取 PDF，并把视频接上。 */
  const openLibraryEntry = useCallback(
    async (entry: LibraryEntry) => {
      const fetched = await fetchBookPdf(entry);

      // 视频走服务器地址直接流式播放，不像离线单文件那样内联，
      // 所以不占浏览器内存，也支持拖动进度。
      // 视频和 PDF 共用同一个版本号：换书时两者通常一起换，
      // 用同一个值就够让浏览器丢掉旧缓存。
      const version = entry.size ? `?v=${entry.size}` : '';
      const video = entry.video
        ? {
            src: `books/${encodeURIComponent(entry.video)}${version}`,
            title: entry.videoTitle || '开场视频',
          }
        : null;

      await openFromSource({
        data: fetched.data,
        title: fetched.title,
        pdfFile: null,
        video,
      });
    },
    [openFromSource],
  );

  // 既没有 ?book= 也不是离线文件时，看看服务器上有没有书架清单。
  // 有就展示书架，没有就回到上传界面（本地单机使用）。
  useEffect(() => {
    // 这两种情况由各自的 effect 负责渲染，启动期到此为止
    if (readBookId() || hasEmbeddedBook()) {
      setStartup(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      const books = await fetchLibrary();
      if (cancelled) return;

      // 没有清单（本地单机使用）就正常回落到上传界面
      if (!books || books.length === 0) {
        setStartup(false);
        return;
      }

      libraryRef.current = books;

      // 只有一本书时，根路径直接就是这本书——分享链接不用再带 ?book=。
      // 注意这里刻意不先 setShelf：否则会先铺出书架、几秒后才跳进书，
      // 看起来就像「打开还是书架」。退出这本书时才把书架亮出来。
      // 多本时才直接展示书架让人选。
      if (books.length !== 1) {
        setShelf(books);
        setStartup(false);
        return;
      }

      // 只有一本：一直在启动画面里等到书真正打开，中途不露出别的界面
      setStatus('正在加载书本…');
      setPhase({ kind: 'working', status: '正在加载书本…' });
      try {
        await openLibraryEntry(books[0]);
      } catch (error) {
        if (cancelled) return;
        console.error(error);
        setPhase({
          kind: 'failed',
          message: error instanceof Error ? error.message : '这本书打不开',
        });
      }
      if (!cancelled) setStartup(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [openLibraryEntry]);

  // 站点模式：URL 带 ?book=<id> 时直接从服务器取那本书。
  useEffect(() => {
    const bookId = readBookId();
    if (!bookId) return;

    setStatus('正在加载书本…');
    setPhase({ kind: 'working', status: '正在加载书本…' });

    let cancelled = false;

    void (async () => {
      try {
        const entries = await fetchLibrary();
        const entry =
          entries?.find((item) => item.id === bookId) ?? {
            id: bookId,
            title: bookId,
          };
        if (cancelled) return;
        await openLibraryEntry(entry);
      } catch (error) {
        if (cancelled) return;
        console.error(error);
        setPhase({
          kind: 'failed',
          message:
            error instanceof Error ? error.message : '这本书打不开',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [openLibraryEntry]);

  // 导出的离线文件里内嵌了整本书，打开即读，不需要任何上传步骤。
  useEffect(() => {
    if (!hasEmbeddedBook()) return;

    setStatus('正在解开内嵌的书…');
    setPhase({ kind: 'working', status: '正在解开内嵌的书…' });

    // base64 解码是同步的、13MB 量级要占住主线程几百毫秒，
    // 所以先让上面的加载态画出来，再开始干重活。
    const timer = window.setTimeout(() => {
      let video: (VideoSource & { title: string }) | null = null;

      try {
        const embedded = readEmbeddedBook();
        if (!embedded) return;

        if (embedded.video?.bytes) {
          const blob = new Blob([embedded.video.bytes], {
            type: embedded.video.mime,
          });
          video = {
            src: URL.createObjectURL(blob),
            revoke: true,
            title: embedded.video.title,
          };
        } else if (embedded.video?.url) {
          // 外链视频：离线文件里只带回了地址，播放时仍需联网。
          video = { src: embedded.video.url, title: embedded.video.title };
        }

        void openFromSource({
          data: embedded.pdf.buffer,
          title: embedded.title,
          pdfFile: null,
          video,
        });
      } catch (error) {
        if (video?.revoke) URL.revokeObjectURL(video.src);
        console.error(error);
        setPhase({
          kind: 'failed',
          message: error instanceof Error ? error.message : '无法读取内嵌的书',
        });
      }
    }, 60);

    return () => window.clearTimeout(timer);
  }, [openFromSource]);

  const handleSubmit = async ({ pdf, video, videoTitle }: SubmitPayload) => {
    const data = await pdf.arrayBuffer();
    void openFromSource({
      data,
      title: pdf.name.replace(/\.pdf$/i, ''),
      pdfFile: pdf,
      video: video ? { ...video, title: videoTitle.trim() || '开场视频' } : null,
    });
  };

  const handleClose = () => {
    releaseResources();
    setHasSourceFile(false);
    setExportState({ kind: 'idle' });

    // 从书里退出来才需要书架。清单在启动时已经拿到过，直接用，
    // 不再多请求一次。
    if (libraryRef.current && libraryRef.current.length > 0) {
      setShelf(libraryRef.current);
    }

    setPhase({ kind: 'idle' });
  };

  const runExport = useCallback(async () => {
    const pdfFile = pdfFileRef.current;
    if (phase.kind !== 'reading' || !pdfFile) return;

    const video = videoRef.current;
    setExportState({ kind: 'working', stage: '正在准备…' });

    try {
      const { html, fileName } = await buildSelfContainedHtml(
        {
          title: phase.book.title,
          pdf: pdfFile,
          video: video
            ? { file: video.file ?? null, src: video.src, title: video.title }
            : null,
        },
        (stage) => setExportState({ kind: 'working', stage }),
      );

      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = createDownloadUrl(blob);

      // 上一次的产物这时才放掉，保证界面上的「重新下载」始终可用。
      if (exportUrlRef.current) URL.revokeObjectURL(exportUrlRef.current);
      exportUrlRef.current = url;

      // 优先让本地服务直接写进 video/；没有这个能力（部署到静态托管后）就退回普通下载。
      const sunk = await saveViaLocalSink(blob);
      if (!sunk) triggerDownload(url, fileName);

      setExportState({
        kind: 'done',
        fileName,
        bytes: blob.size,
        url,
        savedPath: sunk?.path ?? null,
      });
    } catch (error) {
      console.error(error);
      setExportState({
        kind: 'failed',
        message: error instanceof Error ? error.message : '导出失败',
      });
    }
  }, [phase]);

  const handleExportClick = useCallback(() => {
    if (exportState.kind === 'working') return;

    if (exportBlocked) {
      setExportState({ kind: 'failed', message: exportBlocked });
      return;
    }
    void runExport();
  }, [exportBlocked, exportState.kind, runExport]);

  // 失败提示自己收起。「已导出」那条不清——它带着可点的下载链接，
  // 万一自动下载被环境拦掉，用户还得靠它把文件拿走。
  useEffect(() => {
    if (exportState.kind !== 'failed') return;
    const timer = window.setTimeout(() => setExportState({ kind: 'idle' }), 12000);
    return () => window.clearTimeout(timer);
  }, [exportState]);

  if (phase.kind === 'reading') {
    const exportBusy = exportState.kind === 'working';

    const estimate =
      exportBlocked === null && pdfFileRef.current
        ? formatBytes(
            Math.round(
              (pdfFileRef.current.size + (videoRef.current?.file?.size ?? 0)) * 1.34,
            ) + SELF_OVERHEAD_ESTIMATE,
          )
        : null;

    return (
      <FlipBook
        book={phase.book}
        doc={phase.doc}
        onClose={handleClose}
        onExport={handleExportClick}
        exportBusy={exportBusy}
        exportEstimate={estimate}
        exportDownload={
          exportState.kind === 'done'
            ? { url: exportState.url, fileName: exportState.fileName }
            : null
        }
        exportNote={
          exportState.kind === 'working'
            ? exportState.stage
            : exportState.kind === 'done'
              ? exportState.savedPath
                ? `已保存到 ${exportState.savedPath}（${formatBytes(exportState.bytes)}）`
                : `已生成 ${exportState.fileName}（${formatBytes(exportState.bytes)}）· 本地服务未运行，已走普通下载`
              : exportState.kind === 'failed'
                ? exportState.message
                : null
        }
      />
    );
  }

  // 启动期：只显示加载画面，避免书架或上传界面闪出来
  if (startup) {
    return (
      <div className="splash">
        <span className="splash__ring" aria-hidden="true" />
        <p className="splash__text">{status}</p>
      </div>
    );
  }

  if (shelf && !showUpload) {
    return (
      <Bookshelf
        books={shelf}
        onOpen={(id) => {
          window.location.search = '?book=' + encodeURIComponent(id);
        }}
        onLocalUpload={() => setShowUpload(true)}
      />
    );
  }

  return (
    <UploadScreen
      onSubmit={handleSubmit}
      busy={phase.kind === 'working'}
      status={status}
      error={phase.kind === 'failed' ? phase.message : null}
    />
  );
}
