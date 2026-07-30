import type { BroadcastGraphicConfig, GraphicGroupItemConfig, MediaGraphicItemConfig } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import {
	addGraphicGroupChild,
	addGraphicItem,
	broadcastGraphicTemplateDocument,
	placeBroadcastGraphicTemplate,
} from '~~/shared/modules/graphics';

const CANVAS = { canvasWidth: 1920, canvasHeight: 1080 };

function graphic(id: string, items: BroadcastGraphicConfig['items'] = []): BroadcastGraphicConfig {
	return { id, name: id, items };
}

/** A Broadcast Graphic holding a Graphic Group with one child, plus a top-level item. */
function composed(): BroadcastGraphicConfig {
	const withGroup = addGraphicItem(graphic('lower-third'), { kind: 'group', id: 'cluster', ...CANVAS }).graphic;
	const withChild = addGraphicGroupChild(withGroup, { kind: 'shape', groupId: 'cluster', id: 'child' }).graphic;
	return addGraphicItem(withChild, { kind: 'text', id: 'headline', ...CANVAS }).graphic;
}

/** A generator with a stable, readable sequence, so an assertion can name ids. */
function sequentialIds(prefix = 'new') {
	let next = 0;
	return () => `${prefix}-${++next}`;
}

function groupOf(config: BroadcastGraphicConfig): GraphicGroupItemConfig {
	const group = config.items.find(item => item.type === 'group');
	if (group?.type !== 'group')
		throw new Error('expected a Graphic Group');
	return group;
}

describe('broadcastGraphicTemplateDocument', () => {
	it('saves the placed Broadcast Graphic\'s composition as the template document', () => {
		const placed = composed();

		const document = broadcastGraphicTemplateDocument(placed);

		expect(document).toEqual(placed);
	});

	it('never shares structure with the placed graphic it was saved from', () => {
		const placed = composed();

		const document = broadcastGraphicTemplateDocument(placed);
		placed.items[1]!.label = 'renamed after saving';
		groupOf(placed).children[0]!.visible = false;

		expect(document.items[1]!.label).not.toBe('renamed after saving');
		expect(groupOf(document).children[0]!.visible).toBe(true);
	});
});

describe('placeBroadcastGraphicTemplate', () => {
	it('places a copy under a new Broadcast Graphic identity', () => {
		const template = { id: 'template-1', name: 'Lower third', document: composed() };

		const placed = placeBroadcastGraphicTemplate(template, { generateId: sequentialIds(), existing: [] });

		expect(placed.id).toBe('new-1');
		expect(placed.name).toBe('Lower third');
	});

	it('regenerates every Graphic Item id, including a Graphic Group\'s children', () => {
		const template = { id: 'template-1', name: 'Lower third', document: composed() };

		const placed = placeBroadcastGraphicTemplate(template, { generateId: sequentialIds(), existing: [] });

		const placedIds = [
			...placed.items.map(item => item.id),
			...groupOf(placed).children.map(child => child.id),
		];
		expect(placedIds).not.toContain('cluster');
		expect(placedIds).not.toContain('child');
		expect(placedIds).not.toContain('headline');
		expect(new Set(placedIds).size).toBe(placedIds.length);
	});

	it('copies each Graphic Input default as the placed graphic\'s own initial value', () => {
		const document = composed();
		document.inputs = [{
			type: 'text',
			key: 'headline',
			label: 'Headline',
			required: true,
			updatePolicy: 'staged',
			default: 'Match point',
			maxLength: 60,
		}];
		const template = { id: 'template-1', name: 'Lower third', document };

		const placed = placeBroadcastGraphicTemplate(template, { generateId: sequentialIds(), existing: [] });

		expect(placed.inputs).toEqual(document.inputs);
		placed.inputs![0]!.default = 'Edited on the Screen';
		expect(document.inputs[0]!.default).toBe('Match point');
	});

	it('gives the placed copy independently editable Graphic Source Selections and Graphic Input Bindings', () => {
		const document = composed();
		document.sources = [{ key: 'player', label: 'Player', kind: 'player' }];
		document.bindings = [{ inputKey: 'headline', sourceKey: 'player', fieldId: 'player.displayName' }];
		const template = { id: 'template-1', name: 'Lower third', document };

		const placed = placeBroadcastGraphicTemplate(template, { generateId: sequentialIds(), existing: [] });
		placed.sources![0]!.label = 'Winner';
		placed.bindings!.push({ inputKey: 'other', sourceKey: 'player', fieldId: 'player.pronouns' });

		expect(document.sources[0]!.label).toBe('Player');
		expect(document.bindings).toHaveLength(1);
	});

	it('carries the authored Graphic Asset Reference of every Media Graphic Item', () => {
		const document = composed();
		const media = addGraphicItem(document, { kind: 'media', id: 'brand', ...CANVAS }).graphic;
		const item = media.items.find(entry => entry.id === 'brand') as MediaGraphicItemConfig;
		item.asset = { assetId: 'asset-1', revisionId: 'revision-1' };
		item.videoCompatibility = 'chromium-transparency';
		const template = { id: 'template-1', name: 'Lower third', document: media };

		const placed = placeBroadcastGraphicTemplate(template, { generateId: sequentialIds(), existing: [] });

		const placedMedia = placed.items.find(entry => entry.type === 'media') as MediaGraphicItemConfig;
		expect(placedMedia.asset).toEqual({ assetId: 'asset-1', revisionId: 'revision-1' });
		expect(placedMedia.videoCompatibility).toBe('chromium-transparency');
	});

	it('names the copy distinctly when the Screen already carries the template\'s name', () => {
		const template = { id: 'template-1', name: 'Lower third', document: composed() };

		const placed = placeBroadcastGraphicTemplate(template, {
			generateId: sequentialIds(),
			existing: [graphic('a'), { ...graphic('b'), name: 'Lower third' }],
		});

		expect(placed.name).not.toBe('Lower third');
		expect(placed.name.startsWith('Lower third')).toBe(true);
	});

	it('leaves the template document untouched by anything done to the placed copy', () => {
		const document = composed();
		const template = { id: 'template-1', name: 'Lower third', document };

		const placed = placeBroadcastGraphicTemplate(template, { generateId: sequentialIds(), existing: [] });
		placed.items.pop();
		groupOf(placed).children[0]!.label = 'edited';

		expect(document.items).toHaveLength(2);
		expect(groupOf(document).children[0]!.label).not.toBe('edited');
	});

	it('places two copies of one template with no Graphic Item id in common', () => {
		const template = { id: 'template-1', name: 'Lower third', document: composed() };
		const generateId = sequentialIds();

		const first = placeBroadcastGraphicTemplate(template, { generateId, existing: [] });
		const second = placeBroadcastGraphicTemplate(template, { generateId, existing: [first] });

		const ids = (config: BroadcastGraphicConfig) => [
			config.id,
			...config.items.map(item => item.id),
			...groupOf(config).children.map(child => child.id),
		];
		expect(ids(first).some(id => ids(second).includes(id))).toBe(false);
	});
});
