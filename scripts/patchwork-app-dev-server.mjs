import http from 'node:http';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

const appPort = Number(process.env.PORT ?? 9000);
const storybookPort = Number(process.env.STORYBOOK_PORT ?? 9001);
const relayTarget = new URL(process.env.RELAY_TARGET ?? 'http://relay:4000');
const patchworkRoot = process.env.PATCHWORK_ROOT ?? '/workspace/patchwork';
const storybookTarget = new URL(`http://127.0.0.1:${storybookPort}`);
const startTime = Date.now();

let readyLogged = false;

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

async function ensurePatchworkDependencies() {
  try {
    await runCommand('test', ['-x', path.join(patchworkRoot, 'node_modules/.bin/lerna')]);
  } catch {
    await runCommand('yarn', ['install', '--frozen-lockfile'], {
      cwd: patchworkRoot,
      env: process.env,
    });
  }
}

async function ensurePatchworkBuildArtifacts() {
  const requiredPaths = [
    path.join(patchworkRoot, 'packages/components/dist'),
    path.join(patchworkRoot, 'packages/styles/dist'),
    path.join(patchworkRoot, 'packages/icons/dist'),
  ];

  const missingPath = await requiredPaths.reduce(async (foundMissing, requiredPath) => {
    if (await foundMissing) {
      return foundMissing;
    }

    try {
      await runCommand('test', ['-d', requiredPath]);
      return null;
    } catch {
      return requiredPath;
    }
  }, Promise.resolve(null));

  if (missingPath) {
    await runCommand('yarn', ['build:parallel'], {
      cwd: patchworkRoot,
      env: process.env,
    });
  }
}

function logReady() {
  if (readyLogged) {
    return;
  }

  readyLogged = true;
  console.log(`app server listening on 0.0.0.0:${appPort} (dev), ready in ${Date.now() - startTime} ms.`);
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

function isRelayRoute(requestUrl) {
  const pathname = new URL(requestUrl ?? '/', 'http://localhost').pathname;
  return pathname === '/generate' || pathname === '/healthz';
}

const server = http.createServer((request, response) => {
  if (isRelayRoute(request.url)) {
    proxyHttpRequest(relayTarget, request, response);
    return;
  }

  proxyHttpRequest(storybookTarget, request, response);
});

server.on('upgrade', (request, socket, head) => {
  const upstreamSocket = net.connect(storybookPort, '127.0.0.1', () => {
    const headers = Object.entries(request.headers)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\r\n');

    upstreamSocket.write(`${request.method} ${request.url} HTTP/${request.httpVersion}\r\n${headers}\r\n\r\n`);

    if (head.length > 0) {
      upstreamSocket.write(head);
    }

    socket.pipe(upstreamSocket).pipe(socket);
  });

  upstreamSocket.on('error', () => {
    socket.destroy();
  });
});

async function waitForStorybook() {
  while (true) {
    try {
      const response = await fetch(`http://127.0.0.1:${storybookPort}`);
      if (response.ok) {
        logReady();
        return;
      }
    } catch {
      // Keep polling until Storybook is ready.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function main() {
  await ensurePatchworkDependencies();
  await ensurePatchworkBuildArtifacts();

  const storybookProcess = spawn(
    'yarn',
    ['--cwd', 'packages/storybook', 'storybook', 'dev', '--ci', '--host', '0.0.0.0', '-c', '.storybook', '-p', String(storybookPort)],
    {
      cwd: patchworkRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    },
  );

  forwardStream(storybookProcess.stdout, process.stdout);
  forwardStream(storybookProcess.stderr, process.stderr);

  storybookProcess.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });

  process.on('SIGINT', () => storybookProcess.kill('SIGINT'));
  process.on('SIGTERM', () => storybookProcess.kill('SIGTERM'));

  server.listen(appPort, '0.0.0.0');
  await waitForStorybook();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
