import process from 'node:process';

const target = process.argv[2];

if (!target) {
  console.error('Usage: node scripts/wait-for-url.mjs <url>');
  process.exit(1);
}

const timeoutMs = 120_000;
const intervalMs = 2_000;
const deadline = Date.now() + timeoutMs;

while (Date.now() < deadline) {
  try {
    const response = await fetch(target, { method: 'GET' });
    if (response.ok) {
      console.log(`Ready: ${target}`);
      process.exit(0);
    }
  } catch (error) {
    console.log(`Waiting for ${target}: ${error instanceof Error ? error.message : String(error)}`);
  }

  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}

console.error(`Timed out waiting for ${target}`);
process.exit(1);
