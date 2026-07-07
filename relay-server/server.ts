import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import { randomUUID } from 'node:crypto';
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

const GENERATED_COMPONENT_FORMAT = process.env.GENERATED_COMPONENT_FORMAT ?? 'sandbox';
const GENERATED_DIR = path.resolve(
  process.env.GENERATED_DIR ??
    (GENERATED_COMPONENT_FORMAT === 'patchwork'
      ? path.resolve(__dirname, '../patchwork/packages/components/src/generated')
      : path.resolve(__dirname, '../storybook-app/src/components/Generated')),
);
const INDEX_CSS_PATH = process.env.STORYBOOK_INDEX_CSS_PATH
  ? path.resolve(process.env.STORYBOOK_INDEX_CSS_PATH)
  : GENERATED_COMPONENT_FORMAT === 'patchwork'
    ? undefined
    : path.resolve(__dirname, '../storybook-app/src/index.css');
const PROMPTS_DIR = path.resolve(process.env.PROMPTS_DIR ?? path.resolve(__dirname, '../prompts'));
const PROMPT_FACTS_DIR = 'facts';
const PROMPT_GUARDS_DIR = 'guards';
const SYSTEM_PROMPT_ENTRYPOINT = process.env.SYSTEM_PROMPT_FILE ?? 'import.md';

const DEFAULT_MODEL_BY_PROVIDER = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-5-codex',
} as const;
const generatedCodeByKey = new Map<string, string>();
type LlmProvider = keyof typeof DEFAULT_MODEL_BY_PROVIDER;

class LlmConfigurationError extends Error {}
class PromptConfigurationError extends Error {}
type LlmGenerationResult = {
  componentCode: string;
  rawText: string;
};

function logEvent(event: string, payload: Record<string, unknown>) {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      event,
      ...payload,
    }),
  );
}

function getImageSummary(imageBase64: string | undefined) {
  if (!imageBase64) {
    return { hasImage: false, imageBase64Length: 0 };
  }

  return {
    hasImage: true,
    imageBase64Length: imageBase64.length,
    imageBase64Preview: imageBase64.slice(0, 64),
  };
}

function getGeneratedComponentPaths(componentName: string) {
  if (GENERATED_COMPONENT_FORMAT === 'patchwork') {
    const componentDir = path.join(GENERATED_DIR, componentName);

    return {
      componentDir,
      componentPath: path.join(componentDir, 'index.tsx'),
      storyPath: path.join(componentDir, 'stories.tsx'),
    };
  }

  return {
    componentDir: GENERATED_DIR,
    componentPath: path.join(GENERATED_DIR, `${componentName}.tsx`),
    storyPath: path.join(GENERATED_DIR, `${componentName}.stories.tsx`),
  };
}

function getStoryCode(componentName: string) {
  if (GENERATED_COMPONENT_FORMAT === 'patchwork') {
    return `import React from 'react';
import ${componentName} from './index.jsx';

export default {
  title: 'Generated/${componentName}',
  component: ${componentName},
};

export const Default = () => <${componentName} />;
`;
  }

  return `import ${componentName} from './${componentName}'

export default { title: 'Generated/${componentName}', component: ${componentName} };
export const Default = {};
`;
}

async function touchReloadFile() {
  if (!INDEX_CSS_PATH) {
    return;
  }

  let css = await fs.readFile(INDEX_CSS_PATH, 'utf-8');
  css = css.replace(/\n?\/\* _tw-trigger: \d+ \*\/\n?$/, '');
  await fs.writeFile(INDEX_CSS_PATH, css.trimEnd() + `\n/* _tw-trigger: ${Date.now()} */\n`);
}

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

async function resolveLlmConfig() {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY?.trim();
  const openaiApiKey = process.env.OPENAI_API_KEY?.trim();

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
    'LLM credentials required: set ANTHROPIC_API_KEY or OPENAI_API_KEY',
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
): Promise<LlmGenerationResult> {
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

  return {
    rawText: textBlock.text,
    componentCode: extractCode(textBlock.text),
  };
}

async function generateWithOpenAI(
  apiKey: string,
  model: string,
  systemPrompt: string,
  requestText: string,
  imageBase64?: string,
): Promise<LlmGenerationResult> {
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

  return {
    rawText: response.output_text,
    componentCode: extractCode(response.output_text),
  };
}

app.post('/generate', async (req, res) => {
  const requestId = randomUUID();

  try {
    const { nodeId, componentName, nodeTree, imageBase64, prompt } = req.body;

    if (!componentName || !nodeTree) {
      logEvent('generate.inbound.invalid', {
        requestId,
        componentName,
        nodeId,
      });

      return res.status(400).json({ error: 'Missing componentName or nodeTree' });
    }

    const generationKey =
      typeof nodeId === 'string' && nodeId.trim().length > 0 ? nodeId.trim() : componentName;
    const previousCode = generatedCodeByKey.get(generationKey);
    const isFollowUp = Boolean(previousCode);
    const requestText = buildGenerationPrompt(componentName, nodeTree, prompt, previousCode);
    const systemPrompt = await getSystemPrompt();
    const llmConfig = await resolveLlmConfig();
    const imageSummary = getImageSummary(imageBase64);

    logEvent('generate.inbound.request', {
      requestId,
      nodeId,
      componentName,
      generationKey,
      prompt: prompt ?? '',
      nodeTree,
      previousCode,
      isFollowUp,
      ...imageSummary,
    });

    logEvent('generate.outbound.llm_request', {
      requestId,
      provider: llmConfig.provider,
      model: llmConfig.model,
      systemPrompt,
      requestText,
      ...imageSummary,
    });

    const llmResult =
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

    logEvent('generate.inbound.llm_response', {
      requestId,
      provider: llmConfig.provider,
      model: llmConfig.model,
      rawText: llmResult.rawText,
      componentCode: llmResult.componentCode,
    });

    const componentCode = llmResult.componentCode;
    generatedCodeByKey.set(generationKey, componentCode);
    const { componentDir, componentPath, storyPath } = getGeneratedComponentPaths(componentName);
    await fs.mkdir(componentDir, { recursive: true });
    await fs.writeFile(componentPath, componentCode);

    try {
      await fs.access(storyPath);
    } catch {
      await fs.writeFile(storyPath, getStoryCode(componentName));
    }

    await touchReloadFile();

    const responseBody = { status: 'ok', componentName, code: componentCode, isFollowUp };
    logEvent('generate.outbound.response', {
      requestId,
      responseBody,
      componentPath,
      storyPath,
    });
    res.json(responseBody);
  } catch (err) {
    if (err instanceof LlmConfigurationError) {
      logEvent('generate.outbound.error', {
        requestId,
        error: 'LLM credentials required',
        detail: err.message,
      });
      return res.status(500).json({ error: 'LLM credentials required', detail: err.message });
    }

    if (err instanceof PromptConfigurationError) {
      logEvent('generate.outbound.error', {
        requestId,
        error: 'Prompt configuration invalid',
        detail: err.message,
      });
      return res.status(500).json({ error: 'Prompt configuration invalid', detail: err.message });
    }

    console.error('Generation failed:', err);
    logEvent('generate.outbound.error', {
      requestId,
      error: 'Generation failed',
      detail: String(err),
    });
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
