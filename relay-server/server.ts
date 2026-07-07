import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();

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

function extractCode(responseText: string): string {
  // Strip markdown fences if the model adds them despite instructions
  const fenceMatch = responseText.match(/```(?:tsx|jsx|ts|js)?\n([\s\S]*?)```/);
  return fenceMatch ? (fenceMatch[1] ?? '').trim() : responseText.trim();
}

app.post('/generate', async (req, res) => {
  try {
    const { componentName, nodeTree, imageBase64 } = req.body;

    if (!componentName || !nodeTree) {
      return res.status(400).json({ error: 'Missing componentName or nodeTree' });
    }

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
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    const componentCode = extractCode(textBlock.text);

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
    console.error('Generation failed:', err);
    res.status(500).json({ error: 'Generation failed', detail: String(err) });
  }
});

app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok' });
});

const PORT = Number(process.env.PORT ?? 4000);
app.listen(PORT, () => console.log(`Relay server listening on: ${PORT}`));
