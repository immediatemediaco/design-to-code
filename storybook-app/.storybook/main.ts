import type { StorybookConfig } from '@storybook/react-vite';
import { mergeConfig } from 'vite';

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
      server: {
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
      },
    });
  },
};

export default config;
