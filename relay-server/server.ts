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
const PROMPTS_DIR = path.resolve(process.env.PROMPTS_DIR ?? path.resolve(__dirname, '../prompts'));
const PROMPT_FACTS_DIR = 'facts';
const PROMPT_GUARDS_DIR = 'guards';
const SYSTEM_PROMPT_ENTRYPOINT = process.env.SYSTEM_PROMPT_FILE ?? 'import.md';

const DEFAULT_MODEL_BY_PROVIDER = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-5-codex',
} as const;
const CODEX_AUTH_PATH = process.env.CODEX_AUTH_PATH ?? path.join(process.env.HOME ?? '/root', '.codex/auth.json');
const generatedCodeByKey = new Map<string, string>();
type LlmProvider = keyof typeof DEFAULT_MODEL_BY_PROVIDER;

class LlmConfigurationError extends Error {}
class PromptConfigurationError extends Error {}

function extractCode(responseText: string): string {
  const fenceMatch = responseText.match(/```(?:tsx|jsx|ts|js)?\n([\s\S]*?)```/);
  return fenceMatch ? (fenceMatch[1] ?? '').trim() : responseText.trim();
}

async function loadPromptFile(relativePath: string, seen = new Set<string>()): Promise<string> {
  const normalizedPath = path.posix.normalize(relativePath);

  if (normalizedPath.startsWith('..')) {
    throw new PromptConfigurationError(`Prompt import escapes the prompts directory: ${relativePath}`);
  }

  if (seen.has(normalizedPath)) {
    throw new PromptConfigurationError(`Circular prompt import detected for ${normalizedPath}`);
  }

  seen.add(normalizedPath);

  const filePath = path.join(PROMPTS_DIR, normalizedPath);
  const rawPrompt = await fs.readFile(filePath, 'utf-8');
  const lines = rawPrompt.split('\n');
  const resolvedLines: string[] = [];

  for (const line of lines) {
    const importMatch = line.match(/^@import\s+(.+)$/);

    if (!importMatch) {
      resolvedLines.push(line);
      continue;
    }

    const importedPrompt = await loadPromptFile(importMatch[1]!.trim(), new Set(seen));
    resolvedLines.push(importedPrompt);
  }

  return resolvedLines.join('\n').trim();
}

function isGuardPromptPath(relativePath: string) {
  return relativePath === PROMPT_GUARDS_DIR || relativePath.startsWith(`${PROMPT_GUARDS_DIR}/`);
}

function isFactPromptPath(relativePath: string) {
  return relativePath === PROMPT_FACTS_DIR || relativePath.startsWith(`${PROMPT_FACTS_DIR}/`);
}

async function listPromptFilesInDirectory(directory: string) {
  const directoryPath = path.join(PROMPTS_DIR, directory);

  try {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => path.posix.join(directory, entry.name))
      .sort();
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

async function getPromptContent(relativePath: string) {
  const promptBody = await loadPromptFile(relativePath);

  if (isGuardPromptPath(relativePath) || isFactPromptPath(relativePath)) {
    return promptBody;
  }

  const factFiles = await listPromptFilesInDirectory(PROMPT_FACTS_DIR);
  const factContent = await Promise.all(factFiles.map((factFile) => loadPromptFile(factFile)));
  const guardFiles = await listPromptFilesInDirectory(PROMPT_GUARDS_DIR);
  const guardContent = await Promise.all(guardFiles.map((guardFile) => loadPromptFile(guardFile)));
  return [...factContent, ...guardContent, promptBody].filter(Boolean).join('\n\n').trim();
}

async function getSystemPrompt() {
  try {
    return await getPromptContent(SYSTEM_PROMPT_ENTRYPOINT);
  } catch (error) {
    if (error instanceof PromptConfigurationError) {
      throw error;
    }

    throw new PromptConfigurationError(`Unable to load prompts from ${PROMPTS_DIR}`);
  }
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

function buildGenerationPrompt(
  componentName: string,
  nodeTree: unknown,
  prompt: string | undefined,
  previousCode: string | undefined,
) {
  const sections = [
    `Generate a React component named "${componentName}".`,
    `Figma node tree:\n${JSON.stringify(nodeTree, null, 2)}`,
  ];

  if (previousCode) {
    sections.push(
      `Current implementation to update:\n${previousCode}`,
      prompt
        ? `Update request from the designer:\n${prompt}`
        : 'Regenerate the component, keeping it consistent with the original design.',
    );
  } else if (prompt) {
    sections.push(`Additional instructions from the designer:\n${prompt}`);
  }

  return sections.join('\n\n');
}

async function generateWithAnthropic(
  apiKey: string,
  model: string,
  systemPrompt: string,
  requestText: string,
  imageBase64?: string,
) {
  const anthropic = new Anthropic({ apiKey });
  const userContent: Anthropic.MessageParam['content'] = [
    {
      type: 'text',
      text: requestText,
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
    system: systemPrompt,
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
  systemPrompt: string,
  requestText: string,
  imageBase64?: string,
) {
  const openai = new OpenAI({ apiKey });
  const content: ResponseInputMessageContentList = [
    {
      type: 'input_text',
      text: requestText,
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
    instructions: systemPrompt,
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
    const { nodeId, componentName, nodeTree, imageBase64, prompt } = req.body;

    if (!componentName || !nodeTree) {
      return res.status(400).json({ error: 'Missing componentName or nodeTree' });
    }

    const generationKey =
      typeof nodeId === 'string' && nodeId.trim().length > 0 ? nodeId.trim() : componentName;
    const previousCode = generatedCodeByKey.get(generationKey);
    const isFollowUp = Boolean(previousCode);
    const requestText = buildGenerationPrompt(componentName, nodeTree, prompt, previousCode);
    const systemPrompt = await getSystemPrompt();
    const llmConfig = await resolveLlmConfig();
    const componentCode =
      llmConfig.provider === 'openai'
        ? await generateWithOpenAI(
            llmConfig.apiKey,
            llmConfig.model,
            systemPrompt,
            requestText,
            imageBase64,
          )
        : await generateWithAnthropic(
            llmConfig.apiKey,
            llmConfig.model,
            systemPrompt,
            requestText,
            imageBase64,
          );

    generatedCodeByKey.set(generationKey, componentCode);
    await fs.writeFile(path.join(GENERATED_DIR, `${componentName}.tsx`), componentCode);

    const storyPath = path.join(GENERATED_DIR, `${componentName}.stories.tsx`);
    try {
      await fs.access(storyPath);
    } catch {
      const storyCode = `import ${componentName} from './${componentName}'\n\nexport default { title: 'Generated/${componentName}', component: ${componentName} };\nexport const Default = {};\n`;
      await fs.writeFile(storyPath, storyCode);
    }

    let css = await fs.readFile(INDEX_CSS_PATH, 'utf-8');
    css = css.replace(/\n?\/\* _tw-trigger: \d+ \*\/\n?$/, '');
    await fs.writeFile(INDEX_CSS_PATH, css.trimEnd() + `\n/* _tw-trigger: ${Date.now()} */\n`);

    res.json({ status: 'ok', componentName, code: componentCode, isFollowUp });
  } catch (err) {
    if (err instanceof LlmConfigurationError) {
      return res.status(500).json({ error: 'LLM credentials required', detail: err.message });
    }

    if (err instanceof PromptConfigurationError) {
      return res.status(500).json({ error: 'Prompt configuration invalid', detail: err.message });
    }

    console.error('Generation failed:', err);
    res.status(500).json({ error: 'Generation failed', detail: String(err) });
  }
});

app.get('/generate', (_req, res) => {
  res.setHeader('Allow', 'POST');
  res.status(405).json({
    error: 'Method Not Allowed',
    detail: 'Use POST /generate with a JSON body containing componentName and nodeTree.',
  });
});

app.get('/healthz', async (_req, res) => {
  try {
    await getSystemPrompt();
    const llmConfig = await resolveLlmConfig();
    res.json({ status: 'ok', provider: llmConfig.provider, model: llmConfig.model });
  } catch (error) {
    if (error instanceof LlmConfigurationError) {
      return res.status(200).json({ status: 'ok', provider: null, model: null, detail: error.message });
    }

    if (error instanceof PromptConfigurationError) {
      return res.status(500).json({ status: 'error', detail: error.message });
    }

    res.status(500).json({ status: 'error', detail: String(error) });
  }
});

const PORT = Number(process.env.PORT ?? 4000);
app.listen(PORT, () => console.log(`Relay server listening on: ${PORT}`));
