import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { GraphicAssetReferenceStatus } from '~~/shared/types/graphicsAsset';
import type { FeatureMatchLayoutConfig } from '~~/shared/types/screenConfig';
import type { CopiedLayers } from '~/modules/graphics/clipboard';
import { describe, expect, it } from 'vitest';
import { flattenGraphicItems, resolveGraphicThemeTokens, roundedShapeGeometry } from '~~/shared/modules/graphics';
import { FOUNDATION_TOKENS } from '~~/shared/modules/theme';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';
import { ASSET, gameWins, graphic, group, media, shape, socialIcon, surfaceStyle, text } from '~~/test/helpers/graphicsComposition';
import {
	copyGraphicLayers,
	copyGraphicStyle,
	pasteBroadcastGraphicLayers,
	pasteFeatureMatchLayers,
	pasteGraphicStyle,
	readGraphicsClipboard,
	unselectableCopiedItems,
	writeGraphicsClipboard,
} from '~/modules/graphics/clipboard';
import { resolveGraphicsCompositionRenderModel } from '~/modules/graphics/renderModel';

function panelOf(color: string) {
	return surfaceStyle({
		fill: { type: 'solid', color },
	});
}

function shapes(prefix: string, count: number) {
	return Array.from({ length: count }, (_, index) => shape(`${prefix}-${index}`));
}

function sequentialIds() {
	let next = 0;
	return () => `new-${++next}`;
}

function copyItems(from: BroadcastGraphicConfig, ...itemIds: string[]): CopiedLayers {
	return copyGraphicLayers('broadcast-graphics', { composition: from }, itemIds.map(itemId => ({ type: 'item', itemId })))!;
}

function pasteInto(graphics: BroadcastGraphicConfig[], copied: CopiedLayers, options: { graphicId?: string; groupId?: string } = {}) {
	return pasteBroadcastGraphicLayers(copied, {
		graphics,
		graphicId: options.graphicId ?? graphics[0]!.id,
	}, {
		groupId: options.groupId,
		nextId: sequentialIds(),
	});
}

function pastedGraphic(outcome: ReturnType<typeof pasteInto>, graphicId = 'b') {
	if (!outcome.ok)
		throw new Error(`refused: ${outcome.refusal.reason}`);
	return outcome.graphics.find(entry => entry.id === graphicId)!;
}

describe('pasting layers into a Broadcast Graphic', () => {
	it('adds copies in front with fresh ids, offset, keeping a free name and renaming a taken one', () => {
		const source = graphic('a', [
			shape('bed', { x: 10, y: 20 }),
			text('name', { x: 30, y: 40 }),
		]);
		const destination = graphic('b', [
			shape('bed'),
		]);

		const outcome = pasteInto([destination], copyItems(source, 'name', 'bed'));

		expect(outcome.ok && outcome.pasted).toEqual(['new-1', 'new-2']);
		expect(pastedGraphic(outcome).items.map(item => [item.id, item.label, item.x, item.y])).toEqual([
			['bed', 'bed', 10, 20],
			['new-1', 'bed copy', 30, 40],
			['new-2', 'name', 50, 60],
		]);
	});

	it('copies a Graphic Group with its children, each under a fresh id', () => {
		const source = graphic('a', [
			group('lower-third', [
				text('handle'),
				shape('rule'),
			]),
		]);

		const pasted = pastedGraphic(pasteInto([
			graphic('b', []),
		], copyItems(source, 'lower-third')));

		expect(flattenGraphicItems(pasted).map(item => [item.id, item.label])).toEqual([
			['new-1', 'lower-third'],
			['new-2', 'handle'],
			['new-3', 'rule'],
		]);
	});

	it('keeps each layer\'s Graphic Theme Bindings', () => {
		const bound = shape('bed', {
			themeBindings: { surfaceStyle: 'panel', geometry: 'panel-shape' },
		});

		const pasted = pastedGraphic(pasteInto([
			graphic('b', []),
		], copyItems(graphic('a', [bound]), 'bed')));

		expect(pasted.items[0]!.themeBindings).toEqual({ surfaceStyle: 'panel', geometry: 'panel-shape' });
	});

	it.each([
		[
			'into the selected group, keeping where they were on the canvas',
			'box',
			'box',
			[
				['rule', 70, 80],
			],
		],
		[
			'onto the canvas with no group selected, where they were on the canvas',
			undefined,
			undefined,
			[
				['rule', 350, 460],
			],
		],
	] as const)('pastes a group\'s child %s', (_case, groupId, container, expected) => {
		const source = graphic('a', [
			group('frame', [
				shape('rule', { x: 10, y: 20 }),
			], {
				x: 300,
				y: 400,
				padding: 20,
				arrangement: 'canvas',
			}),
		]);
		const destination = graphic('b', [
			group('box', [], {
				x: 280,
				y: 380,
				padding: 0,
				arrangement: 'canvas',
			}),
		]);

		const pasted = pastedGraphic(pasteInto([destination], copyItems(source, 'rule'), { groupId }));

		const list = container
			? (pasted.items.find(item => item.id === container) as ReturnType<typeof group>).children
			: pasted.items.filter(item => item.type !== 'group');
		expect(list.map(item => [item.label, item.x, item.y])).toEqual(expected);
	});

	it('refuses a paste into a Feature Match Layout from a Broadcast Graphic (E24)', () => {
		const copied = copyItems(graphic('a', [
			shape('bed'),
		]), 'bed');

		const outcome = pasteFeatureMatchLayers(copied, DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG.layout, {
			nextId: sequentialIds(),
		});

		expect(outcome).toMatchObject({
			ok: false,
			refusal: { reason: 'other-host', from: 'broadcast-graphics' },
		});
	});

	it.each<[string, 'screen' | 'graphic' | 'group', number, () => BroadcastGraphicConfig[], string | undefined]>([
		[
			'the Screen\'s Graphic Item cap (ADR-0007)',
			'screen',
			300,
			() => [
				graphic('b', []),
				...[1, 2, 3].map(other => graphic(`other-${other}`, shapes(`other-${other}`, 100))),
			],
			undefined,
		],
		[
			'the Broadcast Graphic\'s cap',
			'graphic',
			100,
			() => [
				graphic('b', shapes('b', 100)),
			],
			undefined,
		],
		[
			'the Graphic Group\'s children cap',
			'group',
			50,
			() => [
				graphic('b', [
					group('box', shapes('child', 50)),
				]),
			],
			'box',
		],
	])('refuses a paste whole that would pass %s', (_case, scope, limit, graphics, groupId) => {
		const outcome = pasteInto(graphics(), copyItems(graphic('a', [
			shape('extra'),
		]), 'extra'), { groupId });

		expect(outcome).toMatchObject({
			ok: false,
			refusal: { reason: 'item-cap', scope, limit },
		});
	});

	it.each([
		['into its projection\'s Presentation Group', 'presentation', true],
		['anywhere else', undefined, false],
	] as const)('pastes a projected Social Network Icon only %s', (_case, groupId, admitted) => {
		const destination: BroadcastGraphicConfig = {
			...graphic('b', [
				group('presentation', []),
			]),
			socialProfileProjections: [
				{ key: 'socials', presentationGroupId: 'presentation' } as never,
			],
		};
		const copied = copyItems(graphic('a', [
			socialIcon('icon', {
				network: { projectionKey: 'socials' },
			}),
		]), 'icon');

		const outcome = pasteInto([destination], copied, { groupId });

		expect(outcome.ok).toBe(admitted);
		if (!outcome.ok) {
			expect(outcome.refusal).toEqual({
				reason: 'projection',
				items: ['icon'],
			});
		}
	});
});

// A copy carries token names, never a Theme, so it paints the Theme of the Screen it lands on.
describe('a bound layer pasted onto a Screen whose Event uses another Theme', () => {
	it.each([
		[
			'a Theme setting the accent',
			{ accent: '#445566' },
			'#445566',
		],
		['the Default Theme', {}, FOUNDATION_TOKENS.accent.default],
	])('renders in the values of %s', (_case, theme, painted) => {
		const source = graphic('a', [
			shape('bar', {
				surfaceStyle: panelOf('#000000'),
				themeBindings: { surfaceStyle: 'panel' },
			}),
		]);
		const pasted = pastedGraphic(pasteInto([
			graphic('b', []),
		], copyItems(source, 'bar')));

		const model = resolveGraphicsCompositionRenderModel({
			output: 'overlay',
			graphics: [pasted],
			canvasWidth: 1920,
			canvasHeight: 1080,
			themeTokens: resolveGraphicThemeTokens(theme),
		});

		expect(model.graphics[0]!.items[0]!.surface?.fill.color).toBe(painted);
	});
});

describe('pasting layers into a Feature Match Layout', () => {
	const layout: FeatureMatchLayoutConfig = {
		...DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG.layout,
		sources: [DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG.layout.sources[0]!],
	};

	it('pastes Source Items and Graphic Items together, each list in front of its own', () => {
		const source = layout.sources[0]!;
		const item = layout.composition.items.find(entry => entry.type !== 'group')!;
		const copied = copyGraphicLayers('feature-match-overlay', layout, [
			{ type: 'item', itemId: item.id },
			{ type: 'source', itemId: source.id },
		])!;

		const outcome = pasteFeatureMatchLayers(copied, layout, {
			nextId: sequentialIds(),
		});

		if (!outcome.ok)
			throw new Error(outcome.refusal.reason);
		expect(outcome.pasted).toEqual([
			{ type: 'item', itemId: 'new-1' },
			{ type: 'source', itemId: 'new-2' },
		]);
		expect(outcome.layout.sources.map(entry => [entry.id, entry.label, entry.x])).toEqual([
			[source.id, source.label, source.x],
			['new-2', `${source.label} copy`, source.x + 20],
		]);
		expect(outcome.layout.composition.items.at(-1)).toMatchObject({ id: 'new-1', label: `${item.label} copy`, x: item.x + 20 });
	});

	it('pastes locked layers unlocked, leaving the originals locked (ADR-0063)', () => {
		const locked: FeatureMatchLayoutConfig = {
			...layout,
			sources: [
				{ ...layout.sources[0]!, locked: true },
			],
			composition: {
				...layout.composition,
				items: [
					{
						...shape('s'),
						locked: true,
					},
				],
			},
		};
		const copied = copyGraphicLayers('feature-match-overlay', locked, [
			{ type: 'item', itemId: 's' },
			{ type: 'source', itemId: locked.sources[0]!.id },
		])!;

		const outcome = pasteFeatureMatchLayers(copied, locked, {
			nextId: sequentialIds(),
		});

		if (!outcome.ok)
			throw new Error(outcome.refusal.reason);
		expect([
			...outcome.layout.composition.items,
			...outcome.layout.sources,
		].map(entry => entry.locked)).toEqual([
			true,
			undefined,
			true,
			undefined,
		]);
	});

	it('refuses a paste whole that would pass the layout\'s Graphic Item cap', () => {
		const full: FeatureMatchLayoutConfig = {
			...layout,
			composition: {
				...layout.composition,
				items: shapes('s', 100),
			},
		};
		const copied = copyGraphicLayers('feature-match-overlay', full, [
			{ type: 'item', itemId: 's-0' },
		])!;

		const outcome = pasteFeatureMatchLayers(copied, full, {
			nextId: sequentialIds(),
		});

		expect(outcome).toMatchObject({
			ok: false,
			refusal: { reason: 'item-cap', scope: 'layout', limit: 100 },
		});
	});
});

describe('the Graphic Assets a paste would pin (E25)', () => {
	const ACTIVE: GraphicAssetReferenceStatus = { outcome: 'available', lifecycleState: 'active', kind: 'image' };

	it.each<[string, GraphicAssetReferenceStatus, string[]]>([
		['an active one', ACTIVE, []],
		[
			'a retired one',
			{ ...ACTIVE, lifecycleState: 'retired' },
			['logo'],
		],
		[
			'a trashed one',
			{ ...ACTIVE, lifecycleState: 'trashed' },
			['logo'],
		],
		[
			'a missing one',
			{ outcome: 'missing' },
			['logo'],
		],
		[
			'one whose content is unavailable',
			{ outcome: 'unavailable', retryable: true },
			['logo'],
		],
	])('names each item pinning %s', async (_case, status, expected) => {
		const copied = copyItems(graphic('a', [
			group('bug', [
				media('logo', { asset: ASSET }),
			]),
			shape('bed'),
		]), 'bug', 'bed');

		await expect(unselectableCopiedItems(copied, async () => status)).resolves.toEqual(expected);
	});

	it.each([
		[
			'a library font in its typography',
			text('from', {
				typography: {
					...text('x').typography,
					font: { kind: 'asset', reference: ASSET },
				},
			}),
			['from'],
		],
		[
			'a picture, which a style does not paste',
			media('from', { asset: ASSET }),
			[],
		],
	] as const)('names a copied style pinning %s', async (_case, item, expected) => {
		const retired: GraphicAssetReferenceStatus = { ...ACTIVE, lifecycleState: 'retired' };

		await expect(unselectableCopiedItems(copyGraphicStyle('broadcast-graphics', item), async () => retired)).resolves.toEqual(expected);
	});
});

describe('keeping what was copied in this browser (E23)', () => {
	function memoryStorage(entries: Record<string, string> = {}) {
		const stored = new Map(Object.entries(entries));
		return {
			getItem: (key: string) => stored.get(key) ?? null,
			setItem: (key: string, value: string) => void stored.set(key, value),
			stored,
		};
	}

	it('reads back what was kept, each kind apart', () => {
		const storage = memoryStorage();
		const layers = copyItems(graphic('a', [
			shape('bed'),
		]), 'bed');
		const style = copyGraphicStyle('broadcast-graphics', shape('bed'));

		expect(writeGraphicsClipboard(layers, storage)).toBe(true);
		expect(writeGraphicsClipboard(style, storage)).toBe(true);

		expect(readGraphicsClipboard('layers', storage)).toEqual(layers);
		expect(readGraphicsClipboard('style', storage)).toEqual(style);
	});

	it.each([
		['nothing kept', undefined],
		['text that is not JSON', 'not json'],
		[
			'an entry of another shape',
			JSON.stringify({
				kind: 'layers',
				host: 'somewhere',
				items: [],
				sources: [],
			}),
		],
	])('reads nothing from %s', (_case, raw) => {
		const storage = memoryStorage();
		if (raw !== undefined) {
			writeGraphicsClipboard(copyItems(graphic('a', [
				shape('bed'),
			]), 'bed'), storage);
			const [key] = [
				...storage.stored.keys(),
			];
			storage.stored.set(key!, raw);
		}

		expect(readGraphicsClipboard('layers', storage)).toBeNull();
	});

	it('answers that nothing was kept when the browser refuses', () => {
		const refusing = {
			getItem: () => null,
			setItem: () => {
				throw new Error('QuotaExceededError');
			},
		};

		expect(writeGraphicsClipboard(copyItems(graphic('a', [
			shape('bed'),
		]), 'bed'), refusing)).toBe(false);
	});
});

describe('pasting a style (E26)', () => {
	const panel = surfaceStyle({
		fill: { type: 'solid', color: '#ff0000' },
	});

	it('pastes every style group between items of the same Graphic Item Definition', () => {
		const from = shape('from', {
			surfaceStyle: panel,
			geometry: roundedShapeGeometry(12),
		});
		const to = shape('to', { x: 99 });

		const outcome = pasteGraphicStyle(copyGraphicStyle('broadcast-graphics', from), 'broadcast-graphics', to);

		expect(outcome).toEqual({
			ok: true,
			scope: 'style',
			item: { ...to, surfaceStyle: panel, geometry: from.geometry },
		});
	});

	it('pastes only the Graphic Surface Style between two kinds that both paint one', () => {
		const from = text('from', {
			surfaceStyle: panel,
			typography: {
				...text('x').typography,
				fontSize: 99,
			},
		});
		const to = gameWins('to');

		const outcome = pasteGraphicStyle(copyGraphicStyle('broadcast-graphics', from), 'broadcast-graphics', to);

		expect(outcome).toEqual({
			ok: true,
			scope: 'surface',
			item: { ...to, surfaceStyle: panel },
		});
	});

	it.each([
		[
			'a kind with no Graphic Surface Style',
			shape('from'),
			media('to'),
			'incompatible',
		],
		[
			'the other host (E24)',
			shape('from'),
			shape('to'),
			'other-host',
		],
	] as const)('refuses a style onto %s', (_case, from, to, reason) => {
		const host = reason === 'other-host'
			? 'feature-match-overlay'
			: 'broadcast-graphics';

		expect(pasteGraphicStyle(copyGraphicStyle('broadcast-graphics', from), host, to))
			.toMatchObject({
				ok: false,
				refusal: { reason },
			});
	});

	it.each([
		[
			'bound in the source binds the target to the same token',
			{ surfaceStyle: 'accent-panel' },
			{ surfaceStyle: 'panel' },
			{ surfaceStyle: 'accent-panel' },
		],
		[
			'bound in the source binds an unbound target',
			{ surfaceStyle: 'accent-panel' },
			undefined,
			{ surfaceStyle: 'accent-panel' },
		],
		[
			'unbound in the source detaches the target',
			undefined,
			{ surfaceStyle: 'panel' },
			undefined,
		],
		[
			'bound fill in the source binds the fill and detaches the rest',
			{ 'surfaceStyle.fill': 'accent' },
			{ surfaceStyle: 'panel' },
			{ 'surfaceStyle.fill': 'accent' },
		],
		[
			'outside the pasted groups is kept',
			undefined,
			{ 'surfaceStyle': 'panel', 'typography.color': 'text-primary' },
			{ 'typography.color': 'text-primary' },
		],
	] as const)('a group %s', (_case, sourceBindings, targetBindings, expected) => {
		const from = shape('from', { themeBindings: sourceBindings });
		const to = text('to', { surfaceStyle: panel, themeBindings: targetBindings });

		const outcome = pasteGraphicStyle(copyGraphicStyle('broadcast-graphics', from), 'broadcast-graphics', to);

		expect(outcome.ok && outcome.item.themeBindings).toEqual(expected);
	});
});
