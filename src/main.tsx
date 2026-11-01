import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { installEmbeddedWorker } from './lib/embeddedBook';

// 必须在 pdf.js 真正创建 worker 之前调用：离线文件里的 worker 来自
// 内嵌数据，构建时写死的那个路径在那个文件里指向不存在的资源。
installEmbeddedWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
