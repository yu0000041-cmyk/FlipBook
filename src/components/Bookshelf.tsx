import type { LibraryEntry } from '../lib/library';
import { formatBytes } from '../lib/base64';

interface BookshelfProps {
  books: LibraryEntry[];
  onOpen: (id: string) => void;
  onLocalUpload: () => void;
}

/**
 * 书架：站点根路径的入口，列出服务器上 books/ 里的所有书。
 *
 * 这里不加载任何书的内容，只发一次 index.json 请求——书本身等到
 * 点进去那一刻才开始下载，197 页的 PDF 不该压在首页。
 */
export default function Bookshelf({ books, onOpen, onLocalUpload }: BookshelfProps) {
  return (
    <div className="shelf">
      <header className="shelf__head">
        <p className="shelf__eyebrow">书架</p>
        <h1 className="shelf__title">{books.length} 本书</h1>
        <p className="shelf__hint">
          点开任意一本，手机和电脑上都能像翻书一样阅读。
        </p>
      </header>

      <ul className="shelf__grid">
        {books.map((book) => (
          <li key={book.id} className="shelf__item">
            <button
              type="button"
              className="bookcard"
              onClick={() => onOpen(book.id)}
            >
              <span className="bookcard__cover">
                {book.cover ? (
                  <img
                    className="bookcard__img"
                    src={`books/${book.cover}`}
                    alt=""
                    loading="lazy"
                  />
                ) : (
                  <span className="bookcard__spine" aria-hidden="true" />
                )}
              </span>
              <span className="bookcard__title">{book.title}</span>
              <span className="bookcard__meta">
                {book.pages ? `${book.pages} 页` : ''}
                {book.pages && book.size ? ' · ' : ''}
                {book.size ? formatBytes(book.size) : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <footer className="shelf__foot">
        <button type="button" className="ghost-button" onClick={onLocalUpload}>
          打开本地文件
        </button>
        <span className="shelf__foot-hint">
          不上传服务器，只在当前浏览器里看
        </span>
      </footer>
    </div>
  );
}
