/// <reference types="@figma/plugin-typings" />

figma.showUI(__html__, { width: 320, height: 420 });

function serializeNode(node: SceneNode): any {
  const base: any = {
    type: node.type,
    name: node.name,
    width: node.width,
    height: node.height,
  };

  if ('layoutMode' in node) {
    base.layoutMode = node.layoutMode;
    base.itemSpacing = node.itemSpacing;
    base.paddingLeft = node.paddingLeft;
    base.paddingRight = node.paddingRight;
    base.paddingTop = node.paddingTop;
    base.paddingBottom = node.paddingBottom;
  }

  if ('fills' in node && Array.isArray(node.fills)) {
    base.fills = node.fills
      .filter((f: any) => f.type === 'SOLID')
      .map((f: any) => ({ type: f.type, color: f.color, opacity: f.opacity }));
  }

  if ('cornerRadius' in node && typeof node.cornerRadius === 'number') {
    base.cornerRadius = node.cornerRadius;
  }

  if (node.type === 'TEXT') {
    base.characters = node.characters;
    base.fontSize = node.fontSize;
    base.fontName = node.fontName;
  }

  if ('children' in node) {
    base.children = (node as any).children.map(serializeNode);
  }

  return base;
}

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'generate') {
    const selection = figma.currentPage.selection;

    if (selection.length === 0) {
      figma.ui.postMessage({ type: 'error', message: 'Select a frame first' });
      return;
    }

    const node = selection[0];
    const nodeTree = serializeNode(node);

    const imageBytes = await node.exportAsync({
      format: 'PNG',
      constraint: { type: 'SCALE', value: 2 },
    });

    const base64 = figma.base64Encode(imageBytes);

    figma.ui.postMessage({
      type: 'serialized',
      componentName: node.name.replace(/\s+/g, ''),
      nodeTree,
      imageBase64: base64,
      prompt: msg.prompt,
    });
  }
};
