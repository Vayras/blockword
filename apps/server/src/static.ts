import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** Serves the built web app, falling back to index.html for client-side routes. */
export async function serveStatic(root: string, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://x');
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  let file = path.resolve(root, rel || 'index.html');
  if (!file.startsWith(path.resolve(root) + path.sep) && file !== path.resolve(root)) return false;

  try {
    let info = await stat(file).catch(() => null);
    if (!info || info.isDirectory()) {
      file = path.join(root, 'index.html');
      info = await stat(file).catch(() => null);
      if (!info) return false;
    }
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': TYPES[ext] ?? 'application/octet-stream',
      'Cache-Control': file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    createReadStream(file).pipe(res);
    return true;
  } catch {
    return false;
  }
}
