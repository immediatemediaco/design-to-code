import type { StorybookConfig } from '@storybook/react-vite';
import { mergeConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const patchworkRoot = process.env.PATCHWORK_ROOT?.trim();
const storybookAppRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: [
    '@chromatic-com/storybook',
    '@storybook/addon-vitest',
    '@storybook/addon-a11y',
    '@storybook/addon-docs',
    '@storybook/addon-mcp',
  ],
  framework: '@storybook/react-vite',
  async viteFinal(config) {
    return mergeConfig(config, {
      resolve: {
        alias: patchworkRoot
          ? {
              '@patchwork': patchworkRoot,
            }
          : undefined,
        dedupe: ['react', 'react-dom'],
      },
      server: {
        fs: {
          allow: [storybookAppRoot, patchworkRoot].filter(Boolean),
        },
        proxy: {
          '/generate': {
            target: process.env.STORYBOOK_RELAY_TARGET ?? 'http://localhost:4000',
            changeOrigin: true,
          },
          '/healthz': {
            target: process.env.STORYBOOK_RELAY_TARGET ?? 'http://localhost:4000',
            changeOrigin: true,
          },
        },
        hmr: {
          // Storybook pins the HMR websocket to its own listen port (9000), but that port
          // is internal to the Docker network — only traefik's TLS entrypoint (443) is
          // published to the host. Without this the browser tries to open a websocket to
          // :9000 and never connects, so HMR updates are sent but never received.
          clientPort: Number(process.env.STORYBOOK_HMR_CLIENT_PORT ?? 443),
        },
      },
    });
  },
};
export default config;
