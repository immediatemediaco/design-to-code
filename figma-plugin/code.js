"use strict";
/// <reference types="@figma/plugin-typings" />
figma.showUI(__html__, { width: 320, height: 420 });
const variableNameCache = new Map();
async function resolveVariableAlias(alias) {
    if (variableNameCache.has(alias.id)) {
        return variableNameCache.get(alias.id);
    }
    const variable = await figma.variables.getVariableByIdAsync(alias.id);
    if (!variable) {
        return undefined;
    }
    const collection = await figma.variables.getVariableCollectionByIdAsync(variable.variableCollectionId);
    const resolvedName = collection ? `${collection.name}/${variable.name}` : variable.name;
    variableNameCache.set(alias.id, resolvedName);
    return resolvedName;
}
/**
 * Figma's boundVariables map is keyed by property name and, depending on the
 * property, holds either a single VariableAlias or an array of them (e.g.
 * one per paint in `fills`). Resolve everything down to plain variable names
 * so the relay/model gets real Figma variable identity instead of raw values.
 */
async function resolveBoundVariables(node) {
    const bound = node.boundVariables;
    if (!bound) {
        return undefined;
    }
    const resolved = {};
    for (const [property, value] of Object.entries(bound)) {
        const aliases = (Array.isArray(value) ? value : [value]);
        const names = [];
        for (const alias of aliases) {
            if (!alias || alias.type !== 'VARIABLE_ALIAS') {
                continue;
            }
            const resolvedName = await resolveVariableAlias(alias);
            if (resolvedName) {
                names.push(resolvedName);
            }
        }
        if (names.length > 0) {
            resolved[property] = names.length === 1 ? names[0] : names;
        }
    }
    return Object.keys(resolved).length > 0 ? resolved : undefined;
}
function stripPropertyId(propertyName) {
    // Figma suffixes BOOLEAN/TEXT/INSTANCE_SWAP property names with '#<id>' to
    // disambiguate them internally — meaningless to the model, strip it.
    return propertyName.replace(/#.*$/, '');
}
/**
 * If this node is a component variant (or an instance of one), surface its
 * variant/boolean/text/instance-swap property axes and their possible values
 * — e.g. a "State" axis with options ["Default","Hover","Disabled"] — from
 * just the single selected node, without needing every sibling variant sent
 * separately. This is what lets the model decide a Figma variant set should
 * become one component with a prop instead of a separate component per state.
 */
async function getVariantContext(node) {
    var _a;
    try {
        const instanceNode = node.type === 'INSTANCE' ? node : undefined;
        const componentNode = node.type === 'COMPONENT' ? node : await (instanceNode === null || instanceNode === void 0 ? void 0 : instanceNode.getMainComponentAsync());
        if (!componentNode) {
            return undefined;
        }
        const componentSet = ((_a = componentNode.parent) === null || _a === void 0 ? void 0 : _a.type) === 'COMPONENT_SET' ? componentNode.parent : undefined;
        // Figma throws synchronously here (rather than returning empty/null) when the
        // underlying component set has validation errors of its own — this data is
        // purely a best-effort enrichment, so any failure just means "none available",
        // not a reason to fail the whole generation task.
        const definitions = (componentSet !== null && componentSet !== void 0 ? componentSet : componentNode).componentPropertyDefinitions;
        const currentValues = {};
        if (instanceNode) {
            for (const [key, prop] of Object.entries(instanceNode.componentProperties)) {
                currentValues[stripPropertyId(key)] = prop.value;
            }
        }
        else if (componentNode.variantProperties) {
            Object.assign(currentValues, componentNode.variantProperties);
        }
        const availableProperties = {};
        for (const [key, definition] of Object.entries(definitions !== null && definitions !== void 0 ? definitions : {})) {
            availableProperties[stripPropertyId(key)] = {
                type: definition.type,
                options: definition.variantOptions,
                defaultValue: definition.defaultValue,
            };
        }
        if (Object.keys(currentValues).length === 0 && Object.keys(availableProperties).length === 0) {
            return undefined;
        }
        return { currentValues, availableProperties };
    }
    catch (_b) {
        return undefined;
    }
}
/**
 * A node is worth generating as its own atomic Patchwork component when it's
 * a container type that can meaningfully hold structure of its own. Plain
 * leaves (TEXT, VECTOR, RECTANGLE, ...) are content within a component, not
 * components in their own right, so they're never split out on their own.
 */
function isComponentLikeNode(node) {
    return ((node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE' || node.type === 'GROUP')
        && 'children' in node
        && node.children.length > 0);
}
function serializeFill(fill) {
    if (fill.type === 'SOLID') {
        return { type: fill.type, color: fill.color, opacity: fill.opacity };
    }
    if (fill.type === 'GRADIENT_LINEAR'
        || fill.type === 'GRADIENT_RADIAL'
        || fill.type === 'GRADIENT_ANGULAR'
        || fill.type === 'GRADIENT_DIAMOND') {
        return {
            type: fill.type,
            opacity: fill.opacity,
            stops: fill.gradientStops.map((stop) => ({ position: stop.position, color: stop.color })),
        };
    }
    // Image fills carry no usable pixel data here — flag their presence so the
    // model doesn't silently drop the area, without pretending to know the content.
    if (fill.type === 'IMAGE') {
        return { type: fill.type };
    }
    return undefined;
}
function serializeEffect(effect) {
    if (!effect.visible) {
        return undefined;
    }
    if (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') {
        return {
            type: effect.type,
            color: effect.color,
            offset: effect.offset,
            radius: effect.radius,
            spread: effect.spread,
        };
    }
    if (effect.type === 'LAYER_BLUR' || effect.type === 'BACKGROUND_BLUR') {
        return { type: effect.type, radius: effect.radius };
    }
    return undefined;
}
async function serializeNode(node, generatedChildNames) {
    const base = {
        type: node.type,
        name: node.name,
        width: node.width,
        height: node.height,
        // Relative to the parent's coordinate space — the only way to reproduce
        // layout for content that isn't inside an auto-layout frame, since
        // absolute (non-auto-layout) positioning is very common in Figma files.
        x: node.x,
        y: node.y,
    };
    if ('opacity' in node && typeof node.opacity === 'number' && node.opacity !== 1) {
        base.opacity = node.opacity;
    }
    if ('rotation' in node && typeof node.rotation === 'number' && node.rotation !== 0) {
        base.rotation = node.rotation;
    }
    if ('layoutMode' in node) {
        base.layoutMode = node.layoutMode;
        if (node.layoutMode !== 'NONE') {
            base.itemSpacing = node.itemSpacing;
            base.paddingLeft = node.paddingLeft;
            base.paddingRight = node.paddingRight;
            base.paddingTop = node.paddingTop;
            base.paddingBottom = node.paddingBottom;
            base.primaryAxisAlignItems = node.primaryAxisAlignItems;
            base.counterAxisAlignItems = node.counterAxisAlignItems;
            base.layoutWrap = node.layoutWrap;
        }
    }
    if ('layoutSizingHorizontal' in node) {
        base.layoutSizingHorizontal = node.layoutSizingHorizontal;
        base.layoutSizingVertical = node.layoutSizingVertical;
    }
    if ('fills' in node && Array.isArray(node.fills)) {
        base.fills = node.fills.map(serializeFill).filter(Boolean);
    }
    if ('strokes' in node && Array.isArray(node.strokes) && node.strokes.length > 0) {
        base.strokes = node.strokes.map(serializeFill).filter(Boolean);
        if ('strokeWeight' in node && typeof node.strokeWeight === 'number') {
            base.strokeWeight = node.strokeWeight;
        }
        if ('strokeAlign' in node) {
            base.strokeAlign = node.strokeAlign;
        }
    }
    if ('effects' in node && Array.isArray(node.effects) && node.effects.length > 0) {
        const effects = node.effects.map(serializeEffect).filter(Boolean);
        if (effects.length > 0) {
            base.effects = effects;
        }
    }
    if ('cornerRadius' in node) {
        if (typeof node.cornerRadius === 'number') {
            base.cornerRadius = node.cornerRadius;
        }
        else if ('topLeftRadius' in node) {
            // cornerRadius is figma.mixed when corners differ — fall back to the
            // four individual corners rather than dropping the radius entirely.
            const corners = node;
            base.topLeftRadius = corners.topLeftRadius;
            base.topRightRadius = corners.topRightRadius;
            base.bottomLeftRadius = corners.bottomLeftRadius;
            base.bottomRightRadius = corners.bottomRightRadius;
        }
    }
    if (node.type === 'TEXT') {
        base.characters = node.characters;
        base.fontSize = node.fontSize;
        base.fontName = node.fontName;
        base.fontWeight = node.fontWeight;
        base.textAlignHorizontal = node.textAlignHorizontal;
        base.textAlignVertical = node.textAlignVertical;
        base.letterSpacing = node.letterSpacing;
        base.lineHeight = node.lineHeight;
        base.textCase = node.textCase;
        base.textDecoration = node.textDecoration;
    }
    // Bound Figma variables (Local/Library) are the strongest available signal
    // for which design token a value should map to, so surface them by name
    // instead of leaving the relay/model to guess from resolved pixel/color values.
    const boundVariables = await resolveBoundVariables(node);
    if (boundVariables) {
        base.boundVariables = boundVariables;
    }
    if (node.type === 'COMPONENT' || node.type === 'INSTANCE') {
        const variantContext = await getVariantContext(node);
        if (variantContext) {
            base.variantContext = variantContext;
        }
    }
    if ('children' in node) {
        base.children = await Promise.all(node.children.map(async (child) => {
            const generatedChildInfo = generatedChildNames === null || generatedChildNames === void 0 ? void 0 : generatedChildNames.get(child.id);
            // This child was already generated as its own atomic Patchwork
            // component in an earlier step of this same generation run — point
            // at it instead of re-describing its whole subtree inline, so the
            // model composes it rather than reimplementing it. atomicLevel isn't
            // known yet at this point (the child's own relay call hasn't run) —
            // ui.html patches it in once that response comes back, same as name.
            if (generatedChildInfo) {
                return {
                    type: 'GENERATED_COMPONENT_REF',
                    generatedComponentName: generatedChildInfo.componentName,
                    generatedAtomicLevel: generatedChildInfo.atomicLevel,
                    name: child.name,
                    width: child.width,
                    height: child.height,
                };
            }
            return serializeNode(child);
        }));
    }
    return base;
}
/**
 * Walks the selection depth-first and returns one generation task per
 * component-like node, children before their parent. Each task is meant to
 * be sent to the relay as an independent, atomic /generate call — a sibling
 * or child failing doesn't prevent the others from being attempted — and the
 * parent's task references any children that were generated ahead of it via
 * GENERATED_COMPONENT_REF so the model composes them instead of redoing them.
 */
async function buildGenerationTasks(node, componentNameOverride) {
    const tasks = [];
    const generatedChildNames = new Map();
    if ('children' in node) {
        for (const child of node.children) {
            if (!isComponentLikeNode(child)) {
                continue;
            }
            const childTasks = await buildGenerationTasks(child);
            tasks.push(...childTasks);
            const childOwnTask = childTasks[childTasks.length - 1];
            if (childOwnTask) {
                generatedChildNames.set(child.id, { componentName: childOwnTask.componentName });
            }
        }
    }
    const nodeTree = await serializeNode(node, generatedChildNames);
    const imageBytes = await node.exportAsync({
        format: 'PNG',
        constraint: { type: 'SCALE', value: 2 },
    });
    tasks.push({
        nodeId: node.id,
        componentName: (componentNameOverride && componentNameOverride.trim()) || node.name.replace(/\s+/g, ''),
        nodeTree,
        imageBase64: figma.base64Encode(imageBytes),
    });
    return tasks;
}
figma.ui.onmessage = async (msg) => {
    if (msg.type === 'generate') {
        const selection = figma.currentPage.selection;
        if (selection.length === 0) {
            figma.ui.postMessage({ type: 'error', message: 'Select a frame first' });
            return;
        }
        const node = selection[0];
        const tasks = await buildGenerationTasks(node, msg.componentName);
        figma.ui.postMessage({
            type: 'plan',
            tasks,
            prompt: msg.prompt,
        });
    }
};
//# sourceMappingURL=code.js.map