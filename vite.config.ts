import react from '@vitejs/plugin-react'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import type { Connect, Plugin } from 'vite'

/**
 * 导出落盘插件。
 *
 * 浏览器无权把下载写到指定绝对路径，所以想在本地固定目录留下导出结果，
 * 只能由本地服务代劳：页面把产物 POST 上来，这里写进 video/。
 *
 * 只在 npm run dev / npm run preview 下存在。部署到静态托管后没有这个接口，
 * 前端会自动回退成普通下载。
 */
function exportSink(): Plugin {
  const outDir = resolve(import.meta.dirname, 'video')
  const target = resolve(outDir, 'index.html')

  const handler: Connect.NextHandleFunction = (req, res, next) => {
    if (!req.url || req.url.split('?')[0] !== '/__save-export') {
      next()
      return
    }

    // 预览服务可能用 --host 暴露到局域网。写文件这件事必须限定本机，
    // 否则同网段任何人都能往这台机器的硬盘上写东西。
    const addr = req.socket.remoteAddress ?? ''
    const isLocal =
      addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
    if (!isLocal) {
      res.statusCode = 403
      res.end('local only')
      return
    }

    if (req.method !== 'POST') {
      res.statusCode = 405
      res.end('POST only')
      return
    }

    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
      size += chunk.length
    })
    req.on('end', () => {
      try {
        mkdirSync(outDir, { recursive: true })
        writeFileSync(target, Buffer.concat(chunks))
        console.log(
          `\n  [export] 已写入 ${target}  (${(size / 1048576).toFixed(2)} MB)\n`,
        )
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ ok: true, path: target, bytes: size }))
      } catch (error) {
        res.statusCode = 500
        res.end(String(error))
      }
    })
  }

  return {
    name: 'flipbook-export-sink',
    configureServer(server) {
      server.middlewares.use(handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // 这个应用没有任何客户端路由，全部状态都在内存里，
  // 所以资源用相对路径是最稳的选择：部署在域名根、子路径
  // （例如 GitHub Pages 的 /repo/），甚至直接用 file:// 打开都能跑。
  base: './',
  plugins: [react(), exportSink()],
})
