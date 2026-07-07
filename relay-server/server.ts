import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type {
  ResponseInputImage,
  ResponseInputMessageContentList,
  ResponseInputText,
} from 'openai/resources/responses/responses';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const GENERATED_DIR = path.resolve(
  process.env.GENERATED_DIR ?? path.resolve(__dirname, '../storybook-app/src/components/Generated'),
);
const INDEX_CSS_PATH = path.resolve(
  process.env.STORYBOOK_INDEX_CSS_PATH ?? path.resolve(__dirname, '../storybook-app/src/index.css'),
);

const SYSTEM_PROMPT = `You generate a single React functional component in TypeScript (TSX) from a Figma design description.

Rules:
- Output ONLY the component code, no explanation, no markdown fences.
- Use Tailwind utility classes for ALL styling. No inline styles, no CSS files.
- Export a single default function component.
- Name the component exactly as given in the prompt.
- Use semantic HTML elements where appropriate.
- Map Figma auto-layout frames to flex containers (flex-row or flex-col, gap-*, p-*).
- Map Figma fills to Tailwind background/text color classes, approximating to the nearest Tailwind color if an exact hex isn't available.
- Do not invent props or external dependencies. No imports beyond React itself.`;

const DEFAULT_MODEL_BY_PROVIDER = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-5-codex',
} as const;
const CODEX_AUTH_PATH = process.env.CODEX_AUTH_PATH ?? path.join(process.env.HOME ?? '/root', '.codex/auth.json');
type LlmProvider = keyof typeof DEFAULT_MODEL_BY_PROVIDER;

class LlmConfigurationError extends Error {}

function extractCode(responseText: string): string {
  // Strip markdown fences if the model adds them despite instructions
  const fenceMatch = responseText.match(/```(?:tsx|jsx|ts|js)?\n([\s\S]*?)```/);
  return fenceMatch ? (fenceMatch[1] ?? '').trim() : responseText.trim();
}

function getConfiguredModel(provider: LlmProvider) {
  return DEFAULT_MODEL_BY_PROVIDER[provider];
}

function findOpenAIToken(value: unknown): string | undefined {
  if (!value) {
    return undefined;
  }

  if (typeof value === 'string') {
    return value.trim() || undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const token = findOpenAIToken(item);
      if (token) {
        return token;
      }
    }

    return undefined;
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const preferredKeys = ['api_key', 'apikey', 'key', 'access_token', 'token', 'id_token'];

    for (const key of preferredKeys) {
      const token = findOpenAIToken(record[key]);
      if (token) {
        return token;
      }
    }

    for (const nestedValue of Object.values(record)) {
      const token = findOpenAIToken(nestedValue);
      if (token) {
        return token;
      }
    }
  }

  return undefined;
}

async function getCodexAuthToken() {
  try {
    const rawAuth = await fs.readFile(CODEX_AUTH_PATH, 'utf-8');
    const parsedAuth = JSON.parse(rawAuth) as unknown;
    return findOpenAIToken(parsedAuth);
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error.code === 'ENOENT' || error.code === 'EISDIR')
    ) {
      return undefined;
    }

    throw new LlmConfigurationError(`Unable to read Codex auth file at ${CODEX_AUTH_PATH}`);
  }
}

async function resolveLlmConfig() {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY?.trim();
  const openaiApiKey = process.env.OPENAI_API_KEY?.trim() ?? (await getCodexAuthToken());

  if (anthropicApiKey) {
    return {
      provider: 'anthropic' as const,
      apiKey: anthropicApiKey,
      model: getConfiguredModel('anthropic'),
    };
  }

  if (openaiApiKey) {
    return {
      provider: 'openai' as const,
      apiKey: openaiApiKey,
      model: getConfiguredModel('openai'),
    };
  }

  throw new LlmConfigurationError(
    'LLM credentials required: set ANTHROPIC_API_KEY, OPENAI_API_KEY, or mount ~/.codex/auth.json',
  );
}

async function generateWithAnthropic(
  apiKey: string,
  model: string,
  componentName: string,
  nodeTree: unknown,
  imageBase64?: string,
) {
  const anthropic = new Anthropic({ apiKey });
  const userContent: Anthropic.MessageParam['content'] = [
    {
      type: 'text',
      text: `Generate a React component named "${componentName}" from this Figma node tree:\n\n${JSON.stringify(nodeTree, null, 2)}`,
    },
  ];

  if (imageBase64) {
    userContent.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: imageBase64,
      },
    });
  }

  const response = await anthropic.messages.create({
    model,
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude');
  }

  return extractCode(textBlock.text);
}

async function generateWithOpenAI(
  apiKey: string,
  model: string,
  componentName: string,
  nodeTree: unknown,
  imageBase64?: string,
) {
  const openai = new OpenAI({ apiKey });
  const content: ResponseInputMessageContentList = [
    {
      type: 'input_text',
      text: `Generate a React component named "${componentName}" from this Figma node tree:\n\n${JSON.stringify(nodeTree, null, 2)}`,
    } satisfies ResponseInputText,
  ];

  if (imageBase64) {
    content.push({
      type: 'input_image',
      image_url: `data:image/png;base64,${imageBase64}`,
      detail: 'auto',
    } satisfies ResponseInputImage);
  }

  const response = await openai.responses.create({
    model,
    instructions: SYSTEM_PROMPT,
    input: [
      {
        role: 'user',
        content,
      },
    ],
  });

  if (!response.output_text) {
    throw new Error('No text response from OpenAI');
  }

  return extractCode(response.output_text);
}

app.post('/generate', async (req, res) => {
  try {
    const { componentName, nodeTree, imageBase64 } = req.body;

    if (!componentName || !nodeTree) {
      return res.status(400).json({ error: 'Missing componentName or nodeTree' });
    }

    const llmConfig = await resolveLlmConfig();
    const componentCode =
      llmConfig.provider === 'openai'
        ? await generateWithOpenAI(
            llmConfig.apiKey,
            llmConfig.model,
            componentName,
            nodeTree,
            imageBase64,
          )
        : await generateWithAnthropic(
            llmConfig.apiKey,
            llmConfig.model,
            componentName,
            nodeTree,
            imageBase64,
          );

    await fs.writeFile(path.join(GENERATED_DIR, `${componentName}.tsx`), componentCode);

    const storyPath = path.join(GENERATED_DIR, `${componentName}.stories.tsx`);
    try {
      await fs.access(storyPath);
    } catch {
      const storyCode = `import ${componentName} from './${componentName}'\n\nexport default { title: 'Generated/${componentName}', component: ${componentName} };\nexport const Default = {};\n`;
      await fs.writeFile(storyPath, storyCode);
    }

    // Touch index.css so Tailwind's watcher invalidates the CSS module and
    // rescans the @source glob — this triggers a CSS HMR update in Storybook.
    let css = await fs.readFile(INDEX_CSS_PATH, 'utf-8');
    css = css.replace(/\n?\/\* _tw-trigger: \d+ \*\/\n?$/, '');
    await fs.writeFile(INDEX_CSS_PATH, css.trimEnd() + `\n/* _tw-trigger: ${Date.now()} */\n`);

    res.json({ status: 'ok', componentName, code: componentCode });
  } catch (err) {
    if (err instanceof LlmConfigurationError) {
      return res.status(500).json({ error: 'LLM credentials required', detail: err.message });
    }

    console.error('Generation failed:', err);
    res.status(500).json({ error: 'Generation failed', detail: String(err) });
  }
});

app.get('/healthz', async (_req, res) => {
  try {
    const llmConfig = await resolveLlmConfig();
    res.json({ status: 'ok', provider: llmConfig.provider, model: llmConfig.model });
  } catch (error) {
    if (error instanceof LlmConfigurationError) {
      return res.status(200).json({ status: 'ok', provider: null, model: null, detail: error.message });
    }

    res.status(500).json({ status: 'error', detail: String(error) });
  }
});

const PORT = Number(process.env.PORT ?? 4000);
app.listen(PORT, () => console.log(`Relay server listening on: ${PORT}`));
