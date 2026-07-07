import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const appPort = Number(process.env.PORT ?? 9000);
const relayTarget = new URL(process.env.RELAY_TARGET ?? 'http://relay:4000');
const patchworkRoot = process.env.PATCHWORK_ROOT ?? '/workspace/patchwork';
const storybookStaticRoot = path.join(patchworkRoot, 'packages/storybook/storybook-static');

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
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

function forwardStream(stream, target) {
  stream.on('data', (chunk) => {
    target.write(chunk);
  });
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });

    forwardStream(child.stdout, process.stdout);
    forwardStream(child.stderr, process.stderr);

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${command} exited with signal ${signal}`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 1}`));
        return;
      }

      resolve();
    });
  });
}

async function ensureDirectory(directoryPath) {
  try {
    await fs.access(directoryPath);
    return true;
  } catch {
    return false;
  }
}

async function ensurePatchworkDependencies() {
  if (await ensureDirectory(path.join(patchworkRoot, 'node_modules/.bin/lerna'))) {
    return;
  }

  await runCommand('yarn', ['install', '--frozen-lockfile'], {
    cwd: patchworkRoot,
    env: process.env,
  });
}

async function ensurePatchworkBuildArtifacts() {
  const requiredPaths = [
    path.join(patchworkRoot, 'packages/components/dist'),
    path.join(patchworkRoot, 'packages/styles/dist'),
    path.join(patchworkRoot, 'packages/icons/dist'),
  ];

  for (const requiredPath of requiredPaths) {
    if (!(await ensureDirectory(requiredPath))) {
      await runCommand('yarn', ['build:parallel'], {
        cwd: patchworkRoot,
        env: process.env,
      });
      return;
    }
  }
}

async function ensureStaticStorybook() {
  if (await ensureDirectory(storybookStaticRoot)) {
    return;
  }

  await runCommand('yarn', ['--cwd', 'packages/storybook', 'build-storybook'], {
    cwd: patchworkRoot,
    env: process.env,
  });
}

function proxyHttpRequest(target, request, response) {
  const upstreamUrl = new URL(request.url ?? '/', target);
  const upstreamRequest = http.request(
    upstreamUrl,
    {
      method: request.method,
      headers: request.headers,
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );

  upstreamRequest.on('error', (error) => {
    response.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'Proxy error', detail: String(error) }));
  });

  request.pipe(upstreamRequest);
}

function shouldServeSpaFallback(requestPath) {
  return path.extname(requestPath) === '';
}

async function serveStatic(request, response) {
  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const rawPath = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
  const safePath = path.normalize(rawPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(storybookStaticRoot, safePath);

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

    const fallback = await fs.readFile(path.join(storybookStaticRoot, 'index.html'));
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(fallback);
  }
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.url?.startsWith('/generate') || request.url?.startsWith('/healthz')) {
      proxyHttpRequest(relayTarget, request, response);
      return;
    }

    await serveStatic(request, response);
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'Server error', detail: String(error) }));
  }
});

async function main() {
  await ensurePatchworkDependencies();
  await ensurePatchworkBuildArtifacts();
  await ensureStaticStorybook();

  server.listen(appPort, '0.0.0.0', () => {
    console.log(`app server listening on 0.0.0.0:${appPort} (prod), ready in 0 ms.`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
