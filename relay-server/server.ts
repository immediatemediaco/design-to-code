import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const GENERATED_DIR = path.resolve(__dirname, '../storybook-app/src/components/Generated');

const SYSTEM_PROMPT = `You generate a single React functional component in TypeScript (TSX) from a Figma design description.

Rules:
- Output ONLY the component code, no explanation, no markdown fences.
- Use Tailwind utility classes for ALL styling. No inline styles, no CSS files.
- Export a single default function component.
- Name the component exactly as given in the prompt.
- Use semantic HTML elements where appropriate.
- Map Figma auto-layout frames to flex containers (flex-row or flex-col, gap-*, p-*).
- Map Figma fills to Tailwind background/text color classes, approximating to the nearest Tailwind color if an exact hex isn't available.
- Do not invent props or external dependencies. No imports beyond React itself.
- When the user provides additional instructions, prioritise satisfying them while keeping the component visually close to the original design.`;

type HistoryEntry = Anthropic.MessageParam;

const conversationHistory = new Map<string, HistoryEntry[]>();

function extractCode(responseText: string): string {
  const fenceMatch = responseText.match(/```(?:tsx|jsx|ts|js)?\n([\s\S]*?)```/);
  return fenceMatch ? (fenceMatch[1] ?? '').trim() : responseText.trim();
}

app.post('/generate', async (req, res) => {
  try {
    const { componentName, nodeTree, imageBase64, prompt } = req.body;

    // Log out the prompt
    console.log('Received prompt:', prompt);

    if (!componentName || !nodeTree) {
      return res.status(400).json({ error: 'Missing componentName or nodeTree' });
    }

    const isFollowUp = conversationHistory.has(componentName);
    const history = conversationHistory.get(componentName) ?? [];

    let userContent: Anthropic.MessageParam['content'];

    if (!isFollowUp) {
      userContent = [
        {
          type: 'text',
          text: [
            `Generate a React component named "${componentName}" from this Figma node tree:`,
            JSON.stringify(nodeTree, null, 2),
            prompt ? `\nAdditional instructions from the designer: ${prompt}` : '',
          ].join('\n'),
        },
      ];
      if (imageBase64) {
        userContent.push({
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: imageBase64 },
        });
      }
    } else {
      userContent = [
        {
          type: 'text',
          text: prompt
            ? `Update the component based on this feedback: ${prompt}`
            : 'Regenerate the component, keeping it consistent with the original design.',
        },
      ];
    }

    const messages: HistoryEntry[] = [...history, { role: 'user', content: userContent }];

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages,
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    const componentCode = extractCode(textBlock.text);

    conversationHistory.set(componentName, [
      ...messages,
      { role: 'assistant', content: textBlock.text },
    ]);

    await fs.writeFile(path.join(GENERATED_DIR, `${componentName}.tsx`), componentCode);

    const storyPath = path.join(GENERATED_DIR, `${componentName}.stories.tsx`);
    try {
      await fs.access(storyPath);
    } catch {
      const storyCode = `import ${componentName} from './${componentName}';\n\nexport default { title: 'Generated/${componentName}', component: ${componentName} };\nexport const Default = {};\n`;
      await fs.writeFile(storyPath, storyCode);
    }

    // Touch index.css so Tailwind's watcher invalidates the CSS module and
    // rescans the @source glob — this triggers a CSS HMR update in Storybook.
    const indexCssPath = path.resolve(__dirname, '../storybook-app/src/index.css');
    let css = await fs.readFile(indexCssPath, 'utf-8');
    css = css.replace(/\n?\/\* _tw-trigger: \d+ \*\/\n?$/, '');
    await fs.writeFile(indexCssPath, css.trimEnd() + `\n/* _tw-trigger: ${Date.now()} */\n`);

    res.json({ status: 'ok', componentName, code: componentCode, isFollowUp });
  } catch (err) {
    console.error('Generation failed:', err);
    res.status(500).json({ error: 'Generation failed', detail: String(err) });
  }
});

const PORT = 4000;
app.listen(PORT, () => console.log(`Relay server listening on :${PORT}`));
