import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(dirname, 'storybook-static');
const relayTarget = new URL(process.env.RELAY_TARGET ?? 'http://localhost:4000');
const port = Number(process.env.PORT ?? 9000);

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

function getContentType(filePath) {
  return contentTypes.get(path.extname(filePath)) ?? 'application/octet-stream';
}

function shouldServeSpaFallback(requestPath) {
  return path.extname(requestPath) === '';
}

async function proxyToRelay(request, response) {
  const url = new URL(request.url ?? '/', relayTarget);
  const upstream = await fetch(url, {
    method: request.method,
    headers: request.headers,
    body:
      request.method === 'GET' || request.method === 'HEAD'
        ? undefined
        : Readable.toWeb(request),
    duplex: 'half',
  });

  response.writeHead(upstream.status, Object.fromEntries(upstream.headers.entries()));

  if (!upstream.body) {
    response.end();
    return;
  }

  const reader = upstream.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      response.end();
      return;
    }

    response.write(Buffer.from(value));
  }
}

async function serveStatic(request, response) {
  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const rawPath = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
  const safePath = path.normalize(rawPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(rootDir, safePath);

  try {
    const file = await fs.readFile(filePath);
    response.writeHead(200, { 'Content-Type': getContentType(filePath) });
    response.end(file);
  } catch {
    if (!shouldServeSpaFallback(requestUrl.pathname)) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }

    const fallback = await fs.readFile(path.join(rootDir, 'index.html'));
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(fallback);
  }
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.url?.startsWith('/generate') || request.url?.startsWith('/healthz')) {
      await proxyToRelay(request, response);
      return;
    }

    await serveStatic(request, response);
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'Server error', detail: String(error) }));
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Storybook server listening on ${port}`);
});
