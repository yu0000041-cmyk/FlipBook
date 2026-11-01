import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { renderPdfPage } from '../lib/pdf';
import type { OutlineNode } from '../lib/pdf';

/** 缩略图渲染宽度（CSS 像素）。乘上 DPR 后仍然很小，代价可忽略。 */
const THUMB_WIDTH = 108;

type Tab = 'outline' | 'thumbs';

interface ReaderPanelProps {
  doc: PDFDocumentProxy;
  pageCount: number;
  /** 1-based 当前页 */
  currentPage: number;
  outline: OutlineNode[];
  outlineLoading: boolean;
  onJump: (pageNumber: number) => void;
  onClose: () => void;
}

/**
 * 单张缩略图。
 *
 * 197 页的文档不可能一上来就渲染 197 次 pdf.js，所以每张自己盯着
 * 可视区：只有滚到附近才开始渲染，渲染完立刻断开观察。
 */
function Thumb({
  doc,
  pageNumber,
  active,
  root,
  onJump,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  active: boolean;
  root: HTMLElement | null;
  onJump: (pageNumber: number) => void;
}) {
  const holderRef = useRef<HTMLButtonElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const holder = holderRef.current;
    if (!holder || url || failed) return;

    let cancelled = false;
    let handle: ReturnType<typeof renderPdfPage> | null = null;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();

        handle = renderPdfPage(doc, pageNumber, THUMB_WIDTH, 2);
        handle.promise
          .then((blob) => {
            if (cancelled) return;
            setUrl(URL.createObjectURL(blob));
          })
          .catch((error: unknown) => {
            if (cancelled || (error as Error)?.name === 'AbortError') return;
            setFailed(true);
          });
      },
      { root, rootMargin: '320px 0px' },
    );

    observer.observe(holder);
    return () => {
      cancelled = true;
      observer.disconnect();
      handle?.cancel();
    };
  }, [doc, pageNumber, root, url, failed]);

  // url 换代或组件卸载时释放旧地址
  useEffect(() => {
    if (!url) return;
    return () => URL.revokeObjectURL(url);
  }, [url]);

  return (
    <button
      ref={holderRef}
      type="button"
      className={`thumb${active ? ' is-active' : ''}`}
      onClick={() => onJump(pageNumber)}
      title={`第 ${pageNumber} 页`}
    >
      <span className="thumb__frame">
        {url ? (
          <img className="thumb__img" src={url} alt={`第 ${pageNumber} 页`} />
        ) : (
          <span className="thumb__skeleton">{failed ? '×' : ''}</span>
        )}
      </span>
      <span className="thumb__no">{pageNumber}</span>
    </button>
  );
}

function OutlineList({
  nodes,
  depth,
  currentPage,
  onJump,
}: {
  nodes: OutlineNode[];
  depth: number;
  currentPage: number;
  onJump: (pageNumber: number) => void;
}) {
  return (
    <ul className="outline__list" style={{ paddingLeft: depth === 0 ? 0 : 14 }}>
      {nodes.map((node, index) => (
        <li key={`${depth}-${index}-${node.title}`} className="outline__item">
          <button
            type="button"
            className={`outline__link${
              node.pageNumber === currentPage || node.pageNumber === currentPage + 1 ? ' is-active' : ''
            }`}
            disabled={node.pageNumber === null}
            onClick={() => node.pageNumber !== null && onJump(node.pageNumber)}
          >
            <span className="outline__title">{node.title || '（无标题）'}</span>
            {node.pageNumber !== null && (
              <span className="outline__page">{node.pageNumber}</span>
            )}
          </button>
          {node.children.length > 0 && (
            <OutlineList
              nodes={node.children}
              depth={depth + 1}
              currentPage={currentPage}
              onJump={onJump}
            />
          )}
        </li>
      ))}
    </ul>
  );
}

export default function ReaderPanel({
  doc,
  pageCount,
  currentPage,
  outline,
  outlineLoading,
  onJump,
  onClose,
}: ReaderPanelProps) {
  const [tab, setTab] = useState<Tab>(outline.length > 0 ? 'outline' : 'thumbs');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollRoot, setScrollRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setScrollRoot(scrollRef.current);
  }, []);

  // 打开时把当前页滚进视野，否则每次都要自己找位置
  useEffect(() => {
    if (tab !== 'thumbs') return;
    const active = scrollRef.current?.querySelector('.thumb.is-active');
    active?.scrollIntoView({ block: 'center' });
  }, [tab, currentPage]);

  const jumpAndMaybeClose = useCallback(
    (pageNumber: number) => {
      onJump(pageNumber);
    },
    [onJump],
  );

  const pageNumbers = Array.from({ length: pageCount }, (_, i) => i + 1);

  return (
    <div className="panel">
      <div className="panel__head">
        <div className="panel__tabs">
          <button
            type="button"
            className={`panel__tab${tab === 'outline' ? ' is-active' : ''}`}
            onClick={() => setTab('outline')}
          >
            目录
          </button>
          <button
            type="button"
            className={`panel__tab${tab === 'thumbs' ? ' is-active' : ''}`}
            onClick={() => setTab('thumbs')}
          >
            缩略图
          </button>
        </div>
        <button
          type="button"
          className="panel__close"
          onClick={onClose}
          aria-label="关闭"
        >
          ×
        </button>
      </div>

      <div className="panel__body" ref={scrollRef}>
        {tab === 'outline' ? (
          outlineLoading ? (
            <p className="panel__empty">正在读取目录…</p>
          ) : outline.length === 0 ? (
            <p className="panel__empty">
              这份 PDF 没有内嵌书签，所以没有可跳转的目录。
              <br />
              换到「缩略图」看看每一页。
            </p>
          ) : (
            <OutlineList
              nodes={outline}
              depth={0}
              currentPage={currentPage}
              onJump={jumpAndMaybeClose}
            />
          )
        ) : (
          <div className="thumbs">
            {pageNumbers.map((pageNumber) => (
              <Thumb
                key={pageNumber}
                doc={doc}
                pageNumber={pageNumber}
                active={pageNumber === currentPage}
                root={scrollRoot}
                onJump={jumpAndMaybeClose}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
