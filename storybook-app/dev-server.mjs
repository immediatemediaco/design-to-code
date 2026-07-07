import { spawn } from 'node:child_process';

const port = Number(process.env.PORT ?? 9000);
const startTime = Date.now();
let readyLogged = false;

const child = spawn(
  'npx',
  ['storybook', 'dev', '--host', '0.0.0.0', '-p', String(port)],
  {
    stdio: ['inherit', 'pipe', 'pipe'],
    env: process.env,
  },
);

const logReady = () => {
  if (readyLogged) {
    return;
  }

  readyLogged = true;
  console.log(`app server listening on 0.0.0.0:${port} (dev), ready in ${Date.now() - startTime} ms.`);
};

const forwardStream = (stream, target) => {
  stream.on('data', (chunk) => {
    target.write(chunk);
  });
};

forwardStream(child.stdout, process.stdout);
forwardStream(child.stderr, process.stderr);

const readyPoll = setInterval(async () => {
  if (readyLogged) {
    clearInterval(readyPoll);
    return;
  }

  try {
    const response = await fetch(`http://127.0.0.1:${port}`);
    if (response.ok) {
      logReady();
      clearInterval(readyPoll);
    }
  } catch {
    // Keep polling until Storybook is accepting requests.
  }
}, 500);

child.on('exit', (code, signal) => {
  clearInterval(readyPoll);

  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
