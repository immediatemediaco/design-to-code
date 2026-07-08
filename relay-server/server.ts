import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { promises as dns } from 'node:dns';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { chromium } from 'playwright';
import type {
  ResponseInputImage,
  ResponseInputMessageContentList,
  ResponseInputText,
} from 'openai/resources/responses/responses';

const app = express();

// Figma's plugin UI runs in a sandboxed iframe (Origin: null) inside a
// Chromium-based desktop shell. Chromium's Private Network Access policy
// treats that as the least-trusted network context, and since this host
// resolves to loopback via the local reverse proxy, it requires an explicit
// opt-in on the preflight response or it silently blocks the request — which
// surfaces to the plugin as a generic "failed to fetch", not a CORS error.
// The `cors` middleware has no option for this header, and since it ends
// OPTIONS requests itself, this must run before it to have any effect.
app.use((req, res, next) => {
  if (req.headers['access-control-request-private-network']) {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }

  next();
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const GENERATED_COMPONENT_FORMAT = process.env.GENERATED_COMPONENT_FORMAT ?? 'sandbox';
const GENERATED_DIR = path.resolve(
  process.env.GENERATED_DIR ??
    (GENERATED_COMPONENT_FORMAT === 'patchwork'
      ? path.resolve(__dirname, '../patchwork/packages/components/src/generated')
      : path.resolve(__dirname, '../storybook-app/src/components/Generated'))
);
const INDEX_CSS_PATH = process.env.STORYBOOK_INDEX_CSS_PATH
  ? path.resolve(process.env.STORYBOOK_INDEX_CSS_PATH)
  : GENERATED_COMPONENT_FORMAT === 'patchwork'
    ? undefined
    : path.resolve(__dirname, '../storybook-app/src/index.css');
const PROMPTS_DIR = path.resolve(process.env.PROMPTS_DIR ?? path.resolve(__dirname, '../prompts'));
const PROMPT_FACTS_DIR = 'facts';
const PROMPT_GUARDS_DIR = 'guards';
const PATCHWORK_ROOT = path.resolve(
  process.env.PATCHWORK_ROOT ?? path.resolve(__dirname, '../patchwork')
);
const SYSTEM_PROMPT_ENTRYPOINT = process.env.SYSTEM_PROMPT_FILE ?? 'import.md';

const DEFAULT_MODEL_BY_PROVIDER = {
  anthropic: 'claude-sonnet-5',
  openai: 'gpt-5-codex',
} as const;
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
    })
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

/**
 * Figma layer names routinely contain characters that are invalid in a JS
 * identifier — variant/property layers in particular are named things like
 * "Property 1=Default" or "Size=Large, State=Hover". Used verbatim, that
 * breaks the generated `import Name from './index.jsx'` and `const Name`
 * declarations with a syntax error that then fails the whole webpack build
 * (stories are glob-included, so one bad file blocks every story).
 */
function sanitizeComponentName(rawName: string): string {
  const segments = rawName.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  const pascalCased = segments
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join('');

  if (!pascalCased) {
    return 'GeneratedComponent';
  }

  return /^[A-Za-z_$]/.test(pascalCased) ? pascalCased : `Component${pascalCased}`;
}

function kebabCase(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

function getRootClassName(componentName: string) {
  return `generated-${kebabCase(componentName)}`;
}

const ATOMIC_LEVEL_FOLDERS = {
  atom: 'atoms',
  molecule: 'molecules',
  organism: 'organisms',
} as const;
type AtomicLevel = keyof typeof ATOMIC_LEVEL_FOLDERS;
const ATOMIC_LEVEL_BY_FOLDER: Record<string, AtomicLevel> = Object.fromEntries(
  Object.entries(ATOMIC_LEVEL_FOLDERS).map(([level, folder]) => [folder, level as AtomicLevel])
);

function getGeneratedComponentPaths(componentDir: string) {
  return {
    componentDir,
    componentPath: path.join(componentDir, 'index.tsx'),
    stylesPath: path.join(componentDir, 'styles.scss'),
    testPath: path.join(componentDir, 'index.test.tsx'),
    storyPath: path.join(componentDir, 'stories.tsx'),
  };
}

/**
 * A component's folder is decided once, the first time it's generated, and
 * never moves after that — otherwise a follow-up reclassifying "atom" to
 * "molecule" would silently orphan the original files (and anything that
 * already imports them via the atomic-level-aware @generated alias). This
 * also covers components generated before atomic subfolders existed, sitting
 * flat directly under generated/.
 */
async function findExistingComponentDir(
  componentName: string
): Promise<{ componentDir: string; atomicLevelFolder: string | undefined } | undefined> {
  const candidates: Array<{ componentDir: string; atomicLevelFolder: string | undefined }> = [
    { componentDir: path.join(GENERATED_DIR, componentName), atomicLevelFolder: undefined },
    ...Object.values(ATOMIC_LEVEL_FOLDERS).map((folder) => ({
      componentDir: path.join(GENERATED_DIR, folder, componentName),
      atomicLevelFolder: folder,
    })),
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(path.join(candidate.componentDir, 'index.tsx'));
      return candidate;
    } catch {
      // not this one
    }
  }

  return undefined;
}

/**
 * Follow-up context comes from whatever is actually on disk for this
 * component name, not an in-memory cache — that way "update the existing
 * component" works the same whether it was generated five minutes ago or
 * before the relay last restarted, and regardless of which Figma nodeId
 * triggered it.
 */
async function readExistingComponentCode(componentPath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(componentPath, 'utf-8');
  } catch {
    return undefined;
  }
}

const PATCHWORK_OUTPUT_FILES = ['index.tsx', 'styles.scss', 'stories.tsx', 'index.test.tsx'] as const;

/**
 * The patchwork format needs an atomic-level classification plus four files
 * out of one LLM response (component, SCSS, story, test). Require an
 * explicit `### ATOMIC_LEVEL: x` header and `### FILE: <name>` +
 * fenced-block-per-file shape (mandated by the output-shape guard prompt)
 * rather than guessing at boundaries from a single blob of code.
 */
function parseMultiFileResponse(responseText: string): {
  atomicLevel: AtomicLevel;
  files: Record<string, string>;
} {
  const levelMatch = responseText.match(/###\s*ATOMIC_LEVEL:\s*(atom|molecule|organism)\b/i);
  if (!levelMatch) {
    throw new Error(
      'Model response did not include a valid "### ATOMIC_LEVEL: atom|molecule|organism" header'
    );
  }

  const atomicLevel = levelMatch[1]!.toLowerCase() as AtomicLevel;

  // Tolerate a blank line (or more) between the "### FILE:" header and the
  // opening fence — models routinely add one as natural markdown formatting,
  // and requiring them adjacent caused every file to go "missing" at once.
  const filePattern = /###\s*FILE:\s*([^\n]+)\n+```[a-zA-Z]*\n([\s\S]*?)```/g;
  const files: Record<string, string> = {};

  for (const match of responseText.matchAll(filePattern)) {
    const fileName = match[1]!.trim();
    const fileContent = match[2]!.trim();
    files[fileName] = fileContent;
  }

  const missing = PATCHWORK_OUTPUT_FILES.filter((fileName) => !files[fileName]);
  if (missing.length > 0) {
    throw new Error(
      `Model response did not include the required file section(s): ${missing.join(', ')}`
    );
  }

  return { atomicLevel, files };
}

// Only used for the legacy sandbox format. In patchwork format, stories.tsx
// is one of the four files the model generates itself (see
// PATCHWORK_OUTPUT_FILES) so it can define real Controls/argTypes.
function getStoryCode(componentName: string) {
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
    throw new PromptConfigurationError(
      `Prompt import escapes the prompts directory: ${relativePath}`
    );
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

async function getSystemPrompt(entrypoint: string = SYSTEM_PROMPT_ENTRYPOINT) {
  try {
    return await getPromptContent(entrypoint);
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
    'LLM credentials required: set ANTHROPIC_API_KEY or OPENAI_API_KEY'
  );
}

function buildGenerationPrompt(
  componentName: string,
  nodeTree: unknown,
  prompt: string | undefined,
  previousCode: string | undefined,
  existingAtomicLevel: AtomicLevel | undefined
) {
  const sections = [
    `Generate a React component named "${componentName}".`,
    `Figma node tree:\n${JSON.stringify(nodeTree, null, 2)}`,
  ];

  if (GENERATED_COMPONENT_FORMAT === 'patchwork') {
    sections.push(
      `Use exactly this SCSS root class name for the component's outermost element: "${getRootClassName(componentName)}".`
    );

    if (existingAtomicLevel) {
      sections.push(
        `This component was previously classified as a(n) ${existingAtomicLevel}. It will be written back to that same folder regardless of what you output this time — keep your ATOMIC_LEVEL consistent with that unless the design has fundamentally changed shape, and if it has, say so explicitly rather than silently reclassifying it.`
      );
    }
  }

  if (previousCode) {
    sections.push(
      `Current implementation to update:\n${previousCode}`,
      prompt
        ? `Update request from the designer:\n${prompt}`
        : 'Regenerate the component, keeping it consistent with the original design.'
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
  images: string[] = []
): Promise<LlmGenerationResult> {
  const anthropic = new Anthropic({ apiKey });
  const userContent: Anthropic.MessageParam['content'] = [
    {
      type: 'text',
      text: requestText,
    },
  ];

  for (const imageBase64 of images) {
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
    max_tokens: 20000,
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
  images: string[] = []
): Promise<LlmGenerationResult> {
  const openai = new OpenAI({ apiKey });
  const content: ResponseInputMessageContentList = [
    {
      type: 'input_text',
      text: requestText,
    } satisfies ResponseInputText,
  ];

  for (const imageBase64 of images) {
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

const STORYBOOK_TARGET = process.env.STORYBOOK_TARGET ?? 'http://app:9000';
const VISUAL_CHECK_TIMEOUT_MS = Number(process.env.VISUAL_CHECK_TIMEOUT_MS ?? 45000);

/**
 * Storybook assigns each story an id from its title/name that isn't worth
 * reimplementing (it's a "toId" slugify with its own edge cases) — instead,
 * poll Storybook's own index until it lists a "Default" story whose
 * importPath matches the file we just wrote, and read the id back from there.
 * Polling also absorbs the webpack/styles rebuild latency after a fresh write.
 */
async function findDefaultStoryId(componentDir: string): Promise<string | undefined> {
  const componentsSrcRoot = path.join(PATCHWORK_ROOT, 'packages/components/src');
  const expectedImportPath = `../components/src/${path
    .relative(componentsSrcRoot, path.join(componentDir, 'stories.tsx'))
    .split(path.sep)
    .join('/')}`;

  const deadline = Date.now() + VISUAL_CHECK_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${STORYBOOK_TARGET}/index.json`);
      if (response.ok) {
        const index = (await response.json()) as { entries?: Record<string, unknown> };
        const entry = Object.values(index.entries ?? {}).find(
          (candidate): candidate is { id: string; importPath: string; type: string; name: string } =>
            typeof candidate === 'object'
            && candidate !== null
            && (candidate as { importPath?: unknown }).importPath === expectedImportPath
            && (candidate as { type?: unknown }).type === 'story'
            && (candidate as { name?: unknown }).name === 'Default'
        );

        if (entry) {
          return entry.id;
        }
      }
    } catch {
      // keep polling — the app container's dev server may still be mid-rebuild
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return undefined;
}

/**
 * Best-effort — a failure here (browser launch, navigation timeout) just
 * means the visual-correction step is skipped for this request, not a reason
 * to fail a generation that already succeeded and was written to disk.
 */
/**
 * Chromium silently upgrades navigation to bare single-label hostnames (like
 * the Docker service name "app") to HTTPS, which fails against our plain-HTTP
 * dev server with a TLS error — plain fetch() doesn't have this quirk, only
 * browser navigation does. Resolving to the IP ourselves sidesteps it.
 */
async function resolveTargetForBrowser(target: string): Promise<string> {
  const url = new URL(target);
  try {
    const { address } = await dns.lookup(url.hostname);
    url.hostname = address;
  } catch {
    // Fall back to the original hostname if lookup fails for some reason.
  }
  return url.toString().replace(/\/$/, '');
}

async function captureStoryScreenshot(storyId: string): Promise<string | undefined> {
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;

  try {
    const browserTarget = await resolveTargetForBrowser(STORYBOOK_TARGET);
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    // Not 'networkidle': Storybook's dev server keeps a persistent HMR
    // websocket open, so the page never goes network-idle and that wait
    // condition just times out every time.
    await page.goto(`${browserTarget}/iframe.html?id=${storyId}&viewMode=story`, {
      waitUntil: 'load',
      timeout: 20000,
    });

    const root = page.locator('#storybook-root');
    await root.waitFor({ state: 'attached', timeout: 10000 });
    // Settle beyond first paint for style/font application to finish.
    await page.waitForTimeout(500);

    const target = (await root.count()) > 0 ? root : page;
    const screenshotBuffer = await target.screenshot();
    return screenshotBuffer.toString('base64');
  } catch (error) {
    logEvent('generate.visual_check.screenshot_error', {
      storyId,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

type VisualCorrectionResult = { checked: boolean; corrected: boolean; reason?: string };

/**
 * Renders the just-written component in the real running Storybook, compares
 * it against the original Figma screenshot, and — if the model finds a real
 * discrepancy — overwrites the four files with its correction. Skipped
 * entirely (not an error) when there's no original screenshot to compare
 * against, since there'd be nothing to diff.
 */
async function runVisualCorrection(params: {
  componentName: string;
  componentDir: string;
  originalImageBase64: string | undefined;
  llmConfig: { provider: LlmProvider; apiKey: string; model: string };
}): Promise<VisualCorrectionResult> {
  const { componentName, componentDir, originalImageBase64, llmConfig } = params;

  if (!originalImageBase64) {
    return { checked: false, corrected: false, reason: 'No original Figma screenshot to compare against' };
  }

  const storyId = await findDefaultStoryId(componentDir);
  if (!storyId) {
    return { checked: false, corrected: false, reason: 'Story did not appear in Storybook in time' };
  }

  const storybookScreenshot = await captureStoryScreenshot(storyId);
  if (!storybookScreenshot) {
    return { checked: false, corrected: false, reason: 'Could not capture a Storybook screenshot' };
  }

  const paths = getGeneratedComponentPaths(componentDir);
  const [componentCode, stylesCode, storyCode, testCode] = await Promise.all([
    fs.readFile(paths.componentPath, 'utf-8'),
    fs.readFile(paths.stylesPath, 'utf-8'),
    fs.readFile(paths.storyPath, 'utf-8'),
    fs.readFile(paths.testPath, 'utf-8'),
  ]);

  const requestText = [
    `Component: ${componentName}`,
    `Image 1: the original Figma screenshot (reference).`,
    `Image 2: how the component currently renders in Storybook.`,
    `### FILE: index.tsx\n\`\`\`tsx\n${componentCode}\n\`\`\``,
    `### FILE: styles.scss\n\`\`\`scss\n${stylesCode}\n\`\`\``,
    `### FILE: stories.tsx\n\`\`\`tsx\n${storyCode}\n\`\`\``,
    `### FILE: index.test.tsx\n\`\`\`tsx\n${testCode}\n\`\`\``,
  ].join('\n\n');

  const systemPrompt = await getSystemPrompt('visual-correction.md');
  const images = [originalImageBase64, storybookScreenshot];

  const llmResult =
    llmConfig.provider === 'openai'
      ? await generateWithOpenAI(llmConfig.apiKey, llmConfig.model, systemPrompt, requestText, images)
      : await generateWithAnthropic(llmConfig.apiKey, llmConfig.model, systemPrompt, requestText, images);

  const { files } = parseMultiFileResponse(llmResult.rawText);
  const changed =
    files['index.tsx'] !== componentCode
    || files['styles.scss'] !== stylesCode
    || files['stories.tsx'] !== storyCode
    || files['index.test.tsx'] !== testCode;

  if (!changed) {
    return { checked: true, corrected: false };
  }

  await fs.writeFile(paths.componentPath, files['index.tsx']!);
  await fs.writeFile(paths.stylesPath, files['styles.scss']!);
  await fs.writeFile(paths.storyPath, files['stories.tsx']!);
  await fs.writeFile(paths.testPath, files['index.test.tsx']!);

  return { checked: true, corrected: true };
}

function runGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }

      reject(new Error(`git ${args.join(' ')} failed (exit ${code}): ${(stderr || stdout).trim()}`));
    });
  });
}

async function remoteBranchExists(branchName: string): Promise<boolean> {
  try {
    const output = await runGit(['ls-remote', '--heads', 'origin', branchName], PATCHWORK_ROOT);
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

type GitPushResult = { pushed: true; branch: string } | { pushed: false; error: string };

/**
 * Commits and pushes just the files this request wrote, to a branch named
 * after the component (shared across follow-ups so they accumulate as
 * commits on one branch, like a person iterating on a feature). Runs in a
 * throwaway `git worktree` rather than the main bind-mounted checkout, so it
 * never changes which branch is checked out in the patchwork/ directory
 * developers and other containers actually see.
 */
async function commitAndPushGeneratedComponent(
  componentName: string,
  filePaths: string[],
  isFollowUp: boolean
): Promise<GitPushResult> {
  const branchName = `design-to-code/${kebabCase(componentName)}`;
  const worktreeDir = path.join(os.tmpdir(), `patchwork-push-${randomUUID()}`);

  try {
    await runGit(['fetch', 'origin', branchName], PATCHWORK_ROOT).catch(() => undefined);
    const baseRef = (await remoteBranchExists(branchName)) ? `origin/${branchName}` : 'HEAD';

    await runGit(['worktree', 'add', '--detach', worktreeDir, baseRef], PATCHWORK_ROOT);
    await runGit(['checkout', '-B', branchName], worktreeDir);

    const relativePaths: string[] = [];
    for (const filePath of filePaths) {
      const relativePath = path.relative(PATCHWORK_ROOT, filePath);
      await fs.mkdir(path.dirname(path.join(worktreeDir, relativePath)), { recursive: true });
      await fs.copyFile(filePath, path.join(worktreeDir, relativePath));
      relativePaths.push(relativePath);
    }

    await runGit(['add', ...relativePaths], worktreeDir);

    const statusOutput = await runGit(['status', '--porcelain'], worktreeDir);
    if (!statusOutput.trim()) {
      return { pushed: false, error: 'No changes to commit (output was identical to the last commit)' };
    }

    const commitMessage = isFollowUp
      ? `Update ${componentName} via design-to-code`
      : `Add ${componentName} via design-to-code`;
    await runGit(['commit', '-m', commitMessage], worktreeDir);
    await runGit(['push', '-u', 'origin', `HEAD:${branchName}`], worktreeDir);

    return { pushed: true, branch: branchName };
  } catch (error) {
    return { pushed: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    await runGit(['worktree', 'remove', worktreeDir, '--force'], PATCHWORK_ROOT).catch(() => undefined);
  }
}

app.post('/generate', async (req, res) => {
  const requestId = randomUUID();

  try {
    const { nodeId, componentName: rawComponentName, nodeTree, imageBase64, prompt } = req.body;

    if (!rawComponentName || !nodeTree) {
      logEvent('generate.inbound.invalid', {
        requestId,
        componentName: rawComponentName,
        nodeId,
      });

      return res.status(400).json({ error: 'Missing componentName or nodeTree' });
    }

    const componentName = sanitizeComponentName(rawComponentName);
    const isPatchwork = GENERATED_COMPONENT_FORMAT === 'patchwork';

    const existing = isPatchwork ? await findExistingComponentDir(componentName) : undefined;
    const existingAtomicLevel = existing?.atomicLevelFolder
      ? ATOMIC_LEVEL_BY_FOLDER[existing.atomicLevelFolder]
      : undefined;
    const legacyComponentPath = path.join(GENERATED_DIR, `${componentName}.tsx`);
    const previousCode = await readExistingComponentCode(
      isPatchwork ? path.join(existing?.componentDir ?? '', 'index.tsx') : legacyComponentPath
    );
    const isFollowUp = Boolean(previousCode);
    const requestText = buildGenerationPrompt(
      componentName,
      nodeTree,
      prompt,
      previousCode,
      existingAtomicLevel
    );
    const systemPrompt = await getSystemPrompt();
    const llmConfig = await resolveLlmConfig();
    const imageSummary = getImageSummary(imageBase64);

    logEvent('generate.inbound.request', {
      requestId,
      nodeId,
      rawComponentName,
      componentName,
      existingComponentDir: existing?.componentDir,
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

    const requestImages = imageBase64 ? [imageBase64] : [];
    const llmResult =
      llmConfig.provider === 'openai'
        ? await generateWithOpenAI(
            llmConfig.apiKey,
            llmConfig.model,
            systemPrompt,
            requestText,
            requestImages
          )
        : await generateWithAnthropic(
            llmConfig.apiKey,
            llmConfig.model,
            systemPrompt,
            requestText,
            requestImages
          );

    logEvent('generate.inbound.llm_response', {
      requestId,
      provider: llmConfig.provider,
      model: llmConfig.model,
      rawText: llmResult.rawText,
      componentCode: llmResult.componentCode,
    });

    let componentCode: string;
    let atomicLevelFolder: string | undefined;
    let componentDir: string;
    let componentPath: string;
    let generatedFilePaths: string[] = [];

    if (isPatchwork) {
      const { atomicLevel, files } = parseMultiFileResponse(llmResult.rawText);
      atomicLevelFolder = existing?.atomicLevelFolder ?? ATOMIC_LEVEL_FOLDERS[atomicLevel];
      componentDir = existing?.componentDir ?? path.join(GENERATED_DIR, atomicLevelFolder, componentName);

      const paths = getGeneratedComponentPaths(componentDir);
      componentPath = paths.componentPath;
      componentCode = files['index.tsx']!;

      await fs.mkdir(componentDir, { recursive: true });
      await fs.writeFile(componentPath, componentCode);
      await fs.writeFile(paths.stylesPath, files['styles.scss']!);
      await fs.writeFile(paths.storyPath, files['stories.tsx']!);
      await fs.writeFile(paths.testPath, files['index.test.tsx']!);

      generatedFilePaths = [componentPath, paths.stylesPath, paths.storyPath, paths.testPath];
    } else {
      componentDir = GENERATED_DIR;
      componentPath = legacyComponentPath;
      componentCode = llmResult.componentCode;
      const storyPath = path.join(GENERATED_DIR, `${componentName}.stories.tsx`);

      await fs.mkdir(componentDir, { recursive: true });
      await fs.writeFile(componentPath, componentCode);

      try {
        await fs.access(storyPath);
      } catch {
        await fs.writeFile(storyPath, getStoryCode(componentName));
      }
    }

    await touchReloadFile();

    // Best-effort, same philosophy as the git step below: render what was
    // just written in the real Storybook, compare against the original
    // Figma screenshot, and correct the files in place if the model finds a
    // genuine discrepancy — before committing, so the commit reflects the
    // corrected version rather than needing a separate follow-up commit.
    const visualCheck =
      isPatchwork && generatedFilePaths.length > 0
        ? await runVisualCorrection({
            componentName,
            componentDir,
            originalImageBase64: imageBase64,
            llmConfig,
          }).catch((error) => {
            logEvent('generate.visual_check.error', {
              requestId,
              componentName,
              error: error instanceof Error ? error.message : String(error),
            });
            return { checked: false, corrected: false, reason: 'Visual check failed unexpectedly' };
          })
        : undefined;

    // Best-effort: the component is already fully generated and written at
    // this point regardless of what happens here, so a git failure (no
    // credentials, network down, a genuine conflict) is reported alongside a
    // still-successful response rather than turned into a 500.
    const gitResult =
      isPatchwork && generatedFilePaths.length > 0
        ? await commitAndPushGeneratedComponent(componentName, generatedFilePaths, isFollowUp)
        : undefined;

    if (gitResult && !gitResult.pushed) {
      logEvent('generate.git.error', { requestId, componentName, error: gitResult.error });
    }

    // The response should reflect the corrected code, not the pre-correction
    // version captured before the visual check ran.
    if (visualCheck?.corrected) {
      componentCode = await fs.readFile(componentPath, 'utf-8');
    }

    const responseBody = {
      status: 'ok',
      componentName,
      code: componentCode,
      isFollowUp,
      atomicLevel: atomicLevelFolder,
      visualCheck,
      git: gitResult,
    };
    logEvent('generate.outbound.response', {
      requestId,
      responseBody,
      componentDir,
      componentPath,
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
      return res
        .status(200)
        .json({ status: 'ok', provider: null, model: null, detail: error.message });
    }

    if (error instanceof PromptConfigurationError) {
      return res.status(500).json({ status: 'error', detail: error.message });
    }

    res.status(500).json({ status: 'error', detail: String(error) });
  }
});

const PORT = Number(process.env.PORT ?? 4000);
app.listen(PORT, () => console.log(`Relay server listening on: ${PORT}`));
