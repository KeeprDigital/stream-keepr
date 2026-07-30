import type { BroadcastGraphicConfig, GraphicItemConfig, GraphicItemKind } from '../../types/graphics';
import { getGraphicItemDefinition, graphicItemKindLabel } from './itemDefinitions';

/**
 * Authoring operations for a Screen's back-to-front stack of Broadcast
 * Graphics and for the Graphic Layer Order inside one Broadcast Graphic.
 *
 * Every operation is pure: it returns the next stack or graphic and never
 * mutates its input, so the editor can hand the result straight to the Screen's
 * mode-configuration write and the same rules hold wherever they run.
 *
 * List order is Graphic Layer Order: the last entry is frontmost.
 */

export interface CreateBroadcastGraphicOptions {
	id: string;
	name?: string;
}

export interface CreateBroadcastGraphicResult {
	graphics: BroadcastGraphicConfig[];
	graphicId: string;
}

export interface AddGraphicItemOptions {
	kind: GraphicItemKind;
	id: string;
	canvasWidth: number;
	canvasHeight: number;
}

export interface AddGraphicItemResult {
	graphic: BroadcastGraphicConfig;
	itemId: string;
}

/** The next unused `<prefix> <n>` name among existing names. */
function nextSequentialName(prefix: string, existing: readonly string[]): string {
	const taken = new Set(existing);
	let index = 1;
	while (taken.has(`${prefix} ${index}`))
		index += 1;
	return `${prefix} ${index}`;
}

function moveWithin<T>(entries: readonly T[], index: number, delta: number): T[] {
	const next = [...entries];
	const target = index + delta;
	if (index < 0 || target < 0 || target >= next.length)
		return next;
	const [moved] = next.splice(index, 1);
	next.splice(target, 0, moved!);
	return next;
}

export function createBroadcastGraphic(
	graphics: readonly BroadcastGraphicConfig[],
	options: CreateBroadcastGraphicOptions,
): CreateBroadcastGraphicResult {
	const graphic: BroadcastGraphicConfig = {
		id: options.id,
		name: options.name ?? nextSequentialName('Graphic', graphics.map(entry => entry.name)),
		items: [],
	};

	return { graphics: [...graphics, graphic], graphicId: graphic.id };
}

export function moveBroadcastGraphic(
	graphics: readonly BroadcastGraphicConfig[],
	graphicId: string,
	delta: number,
): BroadcastGraphicConfig[] {
	return moveWithin(graphics, graphics.findIndex(entry => entry.id === graphicId), delta);
}

export function deleteBroadcastGraphic(
	graphics: readonly BroadcastGraphicConfig[],
	graphicId: string,
): BroadcastGraphicConfig[] {
	return graphics.filter(entry => entry.id !== graphicId);
}

export function patchBroadcastGraphic(
	graphics: readonly BroadcastGraphicConfig[],
	graphicId: string,
	patch: Partial<Omit<BroadcastGraphicConfig, 'id'>>,
): BroadcastGraphicConfig[] {
	return graphics.map(entry => entry.id === graphicId ? { ...entry, ...patch } : entry);
}

export function replaceBroadcastGraphic(
	graphics: readonly BroadcastGraphicConfig[],
	graphic: BroadcastGraphicConfig,
): BroadcastGraphicConfig[] {
	return graphics.map(entry => entry.id === graphic.id ? graphic : entry);
}

export function addGraphicItem(
	graphic: BroadcastGraphicConfig,
	options: AddGraphicItemOptions,
): AddGraphicItemResult {
	const item = getGraphicItemDefinition(options.kind).createDefault({
		id: options.id,
		label: nextSequentialName(graphicItemKindLabel(options.kind), graphic.items.map(entry => entry.label)),
		canvasWidth: options.canvasWidth,
		canvasHeight: options.canvasHeight,
	});

	return {
		graphic: { ...graphic, items: [...graphic.items, item] },
		itemId: item.id,
	};
}

export function moveGraphicItem(
	graphic: BroadcastGraphicConfig,
	itemId: string,
	delta: number,
): BroadcastGraphicConfig {
	return {
		...graphic,
		items: moveWithin(graphic.items, graphic.items.findIndex(item => item.id === itemId), delta),
	};
}

export function deleteGraphicItem(graphic: BroadcastGraphicConfig, itemId: string): BroadcastGraphicConfig {
	return { ...graphic, items: graphic.items.filter(item => item.id !== itemId) };
}

export function patchGraphicItem(
	graphic: BroadcastGraphicConfig,
	itemId: string,
	patch: Partial<GraphicItemConfig>,
): BroadcastGraphicConfig {
	return {
		...graphic,
		items: graphic.items.map(item => item.id === itemId ? { ...item, ...patch } as GraphicItemConfig : item),
	};
}
