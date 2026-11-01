/** 一本书里的一页。PDF 页交给 pdf.js 按需渲染，视频页是独立的封面页。 */
export type BookPage =
  | { kind: 'pdf'; pageNumber: number }
  | { kind: 'video'; src: string; title: string };

export interface BookData {
  /** 书名，用文件名或 PDF 元数据里的 Title */
  title: string;
  pages: BookPage[];
  /** 首页宽高比（宽 / 高），决定书页形状 */
  aspect: number;
  /** PDF 里的总页数，不含视频页 */
  pdfPageCount: number;
}

/** 视频源：本地上传得到 blob URL，外链就是普通 URL */
export interface VideoSource {
  src: string;
  /** 本地文件时要记下来，卸载时 revoke */
  revoke?: boolean;
  /** 本地视频的文件本体。导出离线单文件时要读它的字节；外链时为 undefined。 */
  file?: File;
}
