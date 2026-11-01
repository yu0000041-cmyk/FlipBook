import { useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import type { VideoSource } from '../lib/types';

interface UploadScreenProps {
  onSubmit: (payload: {
    pdf: File;
    video: VideoSource | null;
    videoTitle: string;
  }) => void;
  busy: boolean;
  status: string;
  error: string | null;
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

function isWord(file: File): boolean {
  return /\.(docx?|rtf)$/i.test(file.name);
}

function isVideo(file: File): boolean {
  return file.type.startsWith('video/') || /\.(mp4|webm|mov|m4v)$/i.test(file.name);
}

function stripper(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

function WordGuide({ fileName, onDismiss }: { fileName: string; onDismiss: () => void }) {
  return (
    <div className="notice" role="alert">
      <h3 className="notice__title">「{fileName}」需要先另存为 PDF</h3>
      <ol className="notice__steps">
        <li>用 Word 或 WPS 打开这个文件</li>
        <li>
          Word 走「文件 → 另存为」，WPS 走「文件 → 输出为 PDF」
        </li>
        <li>
          保存类型选 <b>PDF (*.pdf)</b>，把导出的文件拖回这里
        </li>
      </ol>
      <p className="notice__why">
        浏览器里做 Word 转 PDF，要么得下载几百 MB 的转换引擎，要么排版会走样。
        交给 Word 自己导出，版式和你看到的完全一致。
      </p>
      <button type="button" className="ghost-button" onClick={onDismiss}>
        知道了
      </button>
    </div>
  );
}

export default function UploadScreen({ onSubmit, busy, status, error }: UploadScreenProps) {
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);

  const [pdf, setPdf] = useState<File | null>(null);
  const [wordName, setWordName] = useState<string | null>(null);
  const [video, setVideo] = useState<VideoSource | null>(null);
  const [videoLabel, setVideoLabel] = useState('');
  const [videoTitle, setVideoTitle] = useState('');
  const [videoTab, setVideoTab] = useState<'file' | 'url'>('file');
  const [urlDraft, setUrlDraft] = useState('');
  const [dragging, setDragging] = useState(false);

  const acceptPdf = (file: File) => {
    setPdf(file);
    setWordName(null);
    if (!videoTitle) setVideoTitle(stripper(file.name));
  };

  const acceptVideo = (file: File) => {
    if (video?.revoke) URL.revokeObjectURL(video.src);
    setVideo({ src: URL.createObjectURL(file), revoke: true, file });
    setVideoLabel(file.name);
    if (!videoTitle) setVideoTitle(stripper(file.name));
  };

  const handleFiles = (files: File[]) => {
    for (const file of files) {
      if (isPdf(file)) acceptPdf(file);
      else if (isWord(file)) setWordName(file.name);
      else if (isVideo(file)) acceptVideo(file);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    handleFiles(Array.from(event.dataTransfer.files));
  };

  const onPickPdf = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) handleFiles([file]);
    event.target.value = '';
  };

  const onPickVideo = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) acceptVideo(file);
    event.target.value = '';
  };

  const applyUrl = () => {
    const value = urlDraft.trim();
    if (!value) return;
    if (video?.revoke) URL.revokeObjectURL(video.src);
    setVideo({ src: value });
    setVideoLabel(value);
  };

  const clearVideo = () => {
    if (video?.revoke) URL.revokeObjectURL(video.src);
    setVideo(null);
    setVideoLabel('');
    setUrlDraft('');
  };

  return (
    <div className="upload">
      <div className="upload__panel">
        <header className="upload__intro">
          <p className="upload__eyebrow">翻页电子书</p>
          <h1 className="upload__headline">
            把 PDF 变成一本
            <br />
            能翻的书
          </h1>
          <p className="upload__lede">
            上传 PDF，自动生成带 3D 翻页效果的书本，电脑和手机都能读。
          </p>
        </header>

        <div
          className={`dropzone${dragging ? ' is-dragging' : ''}${pdf ? ' is-filled' : ''}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => pdfInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') pdfInputRef.current?.click();
          }}
        >
          <input
            ref={pdfInputRef}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            onChange={onPickPdf}
          />

          {pdf ? (
            <>
              <span className="dropzone__badge">PDF</span>
              <span className="dropzone__name">{pdf.name}</span>
              <span className="dropzone__meta">
                {(pdf.size / 1024 / 1024).toFixed(1)} MB · 点击可更换
              </span>
            </>
          ) : (
            <>
              <span className="dropzone__icon" aria-hidden="true" />
              <span className="dropzone__name">拖入 PDF，或点击选择</span>
              <span className="dropzone__meta">
                也支持拖入 MP4 · Word 文档会提示先另存为 PDF
              </span>
            </>
          )}
        </div>

        {wordName && (
          <WordGuide fileName={wordName} onDismiss={() => setWordName(null)} />
        )}

        <section className="video-slot">
          <div className="video-slot__head">
            <h2>开场视频</h2>
            <span className="video-slot__hint">可选 · 放在书本第一页，打开即可播放</span>
          </div>

          <div className="tabs">
            <button
              type="button"
              className={`tabs__item${videoTab === 'file' ? ' is-active' : ''}`}
              onClick={() => setVideoTab('file')}
            >
              本地文件
            </button>
            <button
              type="button"
              className={`tabs__item${videoTab === 'url' ? ' is-active' : ''}`}
              onClick={() => setVideoTab('url')}
            >
              网络链接
            </button>
          </div>

          {videoTab === 'file' ? (
            <div className="video-slot__row">
              <input
                ref={videoInputRef}
                type="file"
                accept="video/mp4,video/*,.mp4,.webm,.mov"
                hidden
                onChange={onPickVideo}
              />
              <button
                type="button"
                className="ghost-button"
                onClick={() => videoInputRef.current?.click()}
              >
                选择 MP4
              </button>
              <span className="video-slot__value">{videoLabel || '尚未选择'}</span>
            </div>
          ) : (
            <div className="video-slot__row">
              <input
                className="text-input"
                type="url"
                placeholder="https://example.com/intro.mp4"
                value={urlDraft}
                onChange={(event) => setUrlDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') applyUrl();
                }}
              />
              <button type="button" className="ghost-button" onClick={applyUrl}>
                使用
              </button>
            </div>
          )}

          {video && (
            <div className="video-slot__actions">
              <input
                className="text-input"
                type="text"
                placeholder="视频页标题（可选）"
                value={videoTitle}
                onChange={(event) => setVideoTitle(event.target.value)}
              />
              <button type="button" className="ghost-button" onClick={clearVideo}>
                移除视频
              </button>
            </div>
          )}
        </section>

        {error && <p className="upload__error">{error}</p>}

        <button
          type="button"
          className="primary-button"
          disabled={!pdf || busy}
          onClick={() => pdf && onSubmit({ pdf, video, videoTitle })}
        >
          {busy ? status : '生成书本'}
        </button>
      </div>
    </div>
  );
}
