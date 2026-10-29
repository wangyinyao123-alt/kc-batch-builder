/**
 * 零依赖静态服务器。
 *
 * 为什么自己写而不是 `npx serve`：这个工具的定位是「离线可用」。
 * 装一个开发依赖来当服务器，等于宣布「不开网就起不来」。
 * 这里只用 node:http + node:fs，80 行够了。
 *
 * 也不需要热更新：改完 JS 跑一次 `npm run build`，刷新页面即可。
 * （构建 25ms，比等 HMR 快。）
 *
 * 用法：npm run serve [-- --port 5173]
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, normalize, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.vsdx': 'application/octet-stream',
};

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('-') ? v : fallback;
}

const PORT = Number(argValue('--port', process.env.PORT || 5173));
const HOST = argValue('--host', '127.0.0.1');

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || HOST}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';

  // 目录穿越防护：normalize 后必须还在 ROOT 内
  const target = resolvePath(ROOT, `.${normalize(pathname)}`);
  if (!target.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  let info;
  try {
    info = await stat(target);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
    return;
  }

  if (info.isDirectory()) {
    res.writeHead(302, { location: `${pathname.replace(/\/$/, '')}/index.html` }).end();
    return;
  }

  res.writeHead(200, {
    'content-type': MIME[extname(target)] || 'application/octet-stream',
    'content-length': info.size,
    // 开发期别缓存，改了刷新就生效
    'cache-control': 'no-store',
  });
  createReadStream(target).pipe(res);
});

server.listen(PORT, HOST, () => {
  console.log(`画布编辑器：http://${HOST}:${PORT}`);
  console.log('（改完源码记得 npm run build）');
});
