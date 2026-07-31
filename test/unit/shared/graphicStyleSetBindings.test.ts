import type { BroadcastGraphicConfig, GraphicItemConfig, TextGraphicItemConfig } from '~~/shared/types/graphics';
import type { GraphicStyleSetEntry } from '~~/shared/types/graphicStyleSet';
import { describe, expect, it } from 'vitest';
import {
	applyGraphicStyleSet,
	captureGraphicStyleOverrides,
	detachGraphicStyleRefs,
	graphicStyleChangeKey,
	graphicStyleSetEntryIdsInDocument,
	graphicStyleUpdateChanges,
	replaceGraphicStyleRefs,
	resolveGraphicStyleSet,
} from '~~/shared/modules/graphic-style-sets';
import { squareShapeGeometry } from '~~/shared/modules/graphics';

/**
 * Referencing Graphic Style Set entries from a graphics composition.
 *
 * The rules under test are the ones a template author would state:
 *
 * - A composition always holds its own resolved values, so it renders and travels
 *   without the Style Set — and a placed copy cannot change under it.
 * - Republishing an entry offers an update to what references it, and to nothing
 *   else. Renaming offers nothing.
 * - Applying an update changes inherited properties and preserves local overrides.
 * - Detaching keeps the values and drops the provenance; replacing keeps both.
 */

function entry<T extends GraphicStyleSetEntry['kind']>(
	kind: T,
	id: string,
	value: Extract<GraphicStyleSetEntry, { kind: T }>['value'],
): GraphicStyleSetEntry {
	return { id, kind, name: id, schemaVersion: 1, value } as GraphicStyleSetEntry;
}

const TYPOGRAPHY = {
	fontId: 'inter' as const,
	fontSize: 48,
	fontWeight: 700,
	fontStyle: 'normal' as const,
	textTransform: 'none' as const,
	letterSpacing: 0,
	lineHeight: 1.1,
	textAlign: 'left' as const,
	color: '#ffffff',
};

function styleSet(brandColor = '#ff0044', headingSize = 64): GraphicStyleSetEntry[] {
	return [
		entry('palette', 'brand', { color: brandColor }),
		entry('palette', 'ink', { color: '#101014' }),
		entry('typography', 'heading', {
			fontId: 'inter',
			fontSize: headingSize,
			fontWeight: 800,
			fontStyle: 'normal',
			textTransform: 'uppercase',
			letterSpacing: 2,
			lineHeight: 1,
			colorEntryId: 'brand',
		}),
		entry('fill', 'panel-fill', { type: 'solid', colorEntryId: 'ink' }),
		entry('surface-style', 'panel', {
			fillEntryId: 'panel-fill',
			fillOpacity: 0.9,
			glow: { colorEntryId: 'brand', size: 8, opacity: 0.5 },
		}),
		entry('shape-geometry', 'cut-corner', {
			...squareShapeGeometry(),
			topRight: { treatment: 'cut', size: 24 },
		}),
		entry('animation-recipe', 'rise', {
			duration: 320,
			easing: 'ease-out',
			slide: { direction: 'north', distanceMode: 'fixed', distance: 40 },
		}),
	];
}

function textItem(overrides: Partial<TextGraphicItemConfig> = {}): TextGraphicItemConfig {
	return {
		type: 'text',
		id: 'headline',
		label: 'Headline',
		visible: true,
		anchor: 'top-left',
		x: 0,
		y: 0,
		width: 600,
		height: 80,
		text: 'Now playing',
		typography: { ...TYPOGRAPHY },
		overflowPolicy: 'shrink',
		minFontSize: 24,
		...overrides,
	};
}

function graphic(items: GraphicItemConfig[], extra: Partial<BroadcastGraphicConfig> = {}): BroadcastGraphicConfig {
	return {
		id: 'lower-third',
		name: 'Lower third',
		items,
		styleSet: { styleSetId: 'show-style', revision: 1 },
		...extra,
	};
}

function headlineOf(config: BroadcastGraphicConfig): TextGraphicItemConfig {
	const item = config.items.find(candidate => candidate.id === 'headline');
	if (item?.type !== 'text')
		throw new Error('expected the Text Graphic Item');
	return item;
}

describe('applyGraphicStyleSet', () => {
	it('writes a typography preset\'s resolved properties into the item and leaves the item-specific ones alone', () => {
		const composition = graphic([textItem({ styleRefs: { typography: { entryId: 'heading' } } })]);

		const applied = applyGraphicStyleSet(composition, resolveGraphicStyleSet(styleSet()));

		expect(headlineOf(applied).typography).toEqual({
			fontId: 'inter',
			fontSize: 64,
			fontWeight: 800,
			fontStyle: 'normal',
			textTransform: 'uppercase',
			letterSpacing: 2,
			lineHeight: 1,
			// Alignment, content, overflow policy and minimum size are the item's own.
			textAlign: 'left',
			color: '#ff0044',
		});
		expect(headlineOf(applied).text).toBe('Now playing');
		expect(headlineOf(applied).overflowPolicy).toBe('shrink');
	});

	it('preserves a local property-level override on top of the preset', () => {
		const composition = graphic([textItem({
			styleRefs: { typography: { entryId: 'heading', overrides: { fontSize: 32 } } },
		})]);

		const applied = applyGraphicStyleSet(composition, resolveGraphicStyleSet(styleSet('#ff0044', 96)));

		expect(headlineOf(applied).typography).toMatchObject({
			// The preset moved to 96 and the author's own 32 still wins.
			fontSize: 32,
			// Everything they did not claim followed the preset.
			color: '#ff0044',
			letterSpacing: 2,
		});
	});

	it('removes an inherited glow the Graphic Surface Style preset no longer carries', () => {
		const shape: GraphicItemConfig = {
			type: 'shape',
			id: 'backing',
			label: 'Backing',
			visible: true,
			anchor: 'top-left',
			x: 0,
			y: 0,
			width: 600,
			height: 80,
			geometry: squareShapeGeometry(),
			surfaceStyle: {
				fill: { type: 'solid', color: '#101014' },
				fillOpacity: 0.9,
				glow: { color: '#ff0044', size: 8, opacity: 0.5 },
			},
			styleRefs: { surfaceStyle: { entryId: 'panel' } },
		};
		const withoutGlow = styleSet().map(candidate => candidate.id === 'panel'
			? entry('surface-style', 'panel', { fillEntryId: 'panel-fill', fillOpacity: 0.9 })
			: candidate);

		const applied = applyGraphicStyleSet(graphic([shape]), resolveGraphicStyleSet(withoutGlow));

		// A merge would have left the glow behind, which would make a preset unable to
		// take back something it once gave.
		expect(applied.items[0]).not.toHaveProperty('glow');
		expect((applied.items[0] as { surfaceStyle?: { glow?: unknown } }).surfaceStyle?.glow).toBeUndefined();
	});

	it('keeps the item\'s own fill when the Graphic Surface Style preset names no Graphic Fill preset', () => {
		const outlineOnly = [
			...styleSet(),
			entry('surface-style', 'edge', { fillOpacity: 1, outline: { colorEntryId: 'brand', width: 4 } }),
		];
		const composition = graphic([textItem({
			surfaceStyle: { fill: { type: 'solid', color: '#00ff88' }, fillOpacity: 1 },
			styleRefs: { surfaceStyle: { entryId: 'edge' } },
		})]);

		const applied = applyGraphicStyleSet(composition, resolveGraphicStyleSet(outlineOnly));

		expect(headlineOf(applied).surfaceStyle).toEqual({
			fill: { type: 'solid', color: '#00ff88' },
			fillOpacity: 1,
			outline: { color: '#ff0044', width: 4 },
		});
	});

	it('lets the finer Graphic Fill reference win over the Graphic Surface Style preset carrying one', () => {
		const entries = [
			...styleSet(),
			entry('fill', 'accent-fill', { type: 'solid', colorEntryId: 'brand' }),
		];
		const composition = graphic([textItem({
			surfaceStyle: { fill: { type: 'solid', color: '#000000' }, fillOpacity: 1 },
			styleRefs: {
				'surfaceStyle': { entryId: 'panel' },
				'surfaceStyle.fill': { entryId: 'accent-fill' },
			},
		})]);

		const applied = applyGraphicStyleSet(composition, resolveGraphicStyleSet(entries));

		expect(headlineOf(applied).surfaceStyle).toMatchObject({
			// The surface preset's own fill is `panel-fill` (ink); the item said something
			// more specific about the fill alone.
			fill: { type: 'solid', color: '#ff0044' },
			fillOpacity: 0.9,
		});
	});

	it('writes a Graphic Animation Recipe preset into the phase its slot names, without on-screen repetition', () => {
		const composition = graphic(
			[textItem({ styleRefs: { 'animation.enter': { entryId: 'rise' } } })],
			{ styleRefs: { 'animation.exit': { entryId: 'rise' } } },
		);

		const applied = applyGraphicStyleSet(composition, resolveGraphicStyleSet(styleSet()));

		const expected = {
			duration: 320,
			easing: 'ease-out',
			delay: 0,
			slide: { direction: 'north', distanceMode: 'fixed', distance: 40 },
		};
		expect(headlineOf(applied).animation?.enter).toEqual(expected);
		// The Broadcast Graphic's own whole-composition motion, through the same slot
		// vocabulary and the same entry.
		expect(applied.animation?.exit).toEqual(expected);
		expect(applied.animation?.exit).not.toHaveProperty('repeat');
	});

	it('carries an on-screen preset\'s repetition defaults only into the on-screen phase', () => {
		const pulsing = [
			...styleSet(),
			entry('animation-recipe', 'pulse', {
				duration: 800,
				easing: 'ease-in-out',
				scale: { factor: 1.05, origin: 'center' },
				pause: 400,
				repeat: 'indefinite',
			}),
		];
		const composition = graphic([textItem({ styleRefs: { 'animation.on-screen': { entryId: 'pulse' } } })]);

		const applied = applyGraphicStyleSet(composition, resolveGraphicStyleSet(pulsing));

		expect(headlineOf(applied).animation?.['on-screen'])
			.toMatchObject({ pause: 400, repeat: 'indefinite' });
	});

	it('leaves a reference the Style Set can no longer honour exactly as it is', () => {
		const composition = graphic([textItem({ styleRefs: { typography: { entryId: 'heading' } } })]);

		// A Style Set that failed to load must not quietly turn a linked composition local.
		const applied = applyGraphicStyleSet(composition, resolveGraphicStyleSet([]));

		expect(headlineOf(applied).typography).toEqual(TYPOGRAPHY);
		expect(headlineOf(applied).styleRefs).toEqual({ typography: { entryId: 'heading' } });
	});

	it('ignores a reference in a slot the Graphic Item cannot hold', () => {
		const media: GraphicItemConfig = {
			type: 'media',
			id: 'bug',
			label: 'Bug',
			visible: true,
			anchor: 'top-left',
			x: 0,
			y: 0,
			width: 200,
			height: 200,
			mediaKind: 'image',
			fit: 'cover',
			focalPosition: { horizontal: 0.5, vertical: 0.5 },
			opacity: 1,
			playbackRate: 1,
			loop: true,
			styleRefs: { typography: { entryId: 'heading' } },
		};

		const applied = applyGraphicStyleSet(graphic([media]), resolveGraphicStyleSet(styleSet()));

		expect(applied.items[0]).not.toHaveProperty('typography');
	});

	it('records the revision the composition has been reconciled to', () => {
		const composition = graphic([textItem({ styleRefs: { typography: { entryId: 'heading' } } })]);

		const applied = applyGraphicStyleSet(composition, resolveGraphicStyleSet(styleSet()), { revision: 7 });

		expect(applied.styleSet).toEqual({ styleSetId: 'show-style', revision: 7 });
	});

	it('preserves the previously resolved property as a new local override when review says so', () => {
		const composition = graphic([textItem({
			typography: { ...TYPOGRAPHY, fontSize: 64, color: '#ff0044' },
			styleRefs: { typography: { entryId: 'heading' } },
		})]);

		const applied = applyGraphicStyleSet(
			composition,
			resolveGraphicStyleSet(styleSet('#00ff88', 96)),
			{ decisions: { [graphicStyleChangeKey('headline', 'typography')]: 'keep-as-override' } },
		);

		// The property did not move…
		expect(headlineOf(applied).typography).toMatchObject({ fontSize: 64, color: '#ff0044' });
		// …and it will not move on the next republish either, because it is now the
		// author's own.
		expect(headlineOf(applied).styleRefs?.typography?.overrides)
			.toMatchObject({ fontSize: 64, color: '#ff0044' });
		expect(headlineOf(applied).styleRefs?.typography?.entryId).toBe('heading');
	});

	it('never mutates the composition it was given', () => {
		const composition = graphic([textItem({ styleRefs: { typography: { entryId: 'heading' } } })]);

		applyGraphicStyleSet(composition, resolveGraphicStyleSet(styleSet()));

		expect(headlineOf(composition).typography).toEqual(TYPOGRAPHY);
	});
});

describe('graphicStyleUpdateChanges', () => {
	function applied(entries: GraphicStyleSetEntry[]): BroadcastGraphicConfig {
		return applyGraphicStyleSet(
			graphic([textItem({ styleRefs: { typography: { entryId: 'heading' } } })]),
			resolveGraphicStyleSet(entries),
		);
	}

	it('offers nothing when the published entries resolve to what the composition already renders', () => {
		const entries = styleSet();

		expect(graphicStyleUpdateChanges(applied(entries), resolveGraphicStyleSet(entries))).toEqual([]);
	});

	it('offers nothing for a rename, because a rename changes no resolved value', () => {
		const entries = styleSet();
		const composition = applied(entries);
		const renamed = entries.map(candidate =>
			candidate.id === 'heading' ? { ...candidate, name: 'Show heading' } : candidate,
		);

		expect(graphicStyleUpdateChanges(composition, resolveGraphicStyleSet(renamed))).toEqual([]);
	});

	it('offers nothing for a change to an entry this composition never references', () => {
		const entries = styleSet();
		const composition = applied(entries);
		const unusedChanged = [
			...entries,
			entry('palette', 'unused', { color: '#123456' }),
		].map(candidate => candidate.id === 'panel-fill'
			? entry('fill', 'panel-fill', { type: 'solid', colorEntryId: 'unused' })
			: candidate);

		expect(graphicStyleUpdateChanges(composition, resolveGraphicStyleSet(unusedChanged))).toEqual([]);
	});

	it('offers a change when a referenced entry\'s own value changes', () => {
		const composition = applied(styleSet());

		const changes = graphicStyleUpdateChanges(composition, resolveGraphicStyleSet(styleSet('#ff0044', 96)));

		expect(changes).toHaveLength(1);
		expect(changes[0]).toMatchObject({
			ownerItemId: 'headline',
			ownerLabel: 'Headline',
			slot: 'typography',
			entryId: 'heading',
			entryName: 'heading',
		});
		expect((changes[0]!.current as { fontSize: number }).fontSize).toBe(64);
		expect((changes[0]!.next as { fontSize: number }).fontSize).toBe(96);
	});

	it('offers a change when a referenced entry\'s transitive dependency changes', () => {
		const composition = applied(styleSet());

		// `heading` is untouched; the palette entry it links its colour to moved.
		const changes = graphicStyleUpdateChanges(composition, resolveGraphicStyleSet(styleSet('#00ff88')));

		expect(changes).toHaveLength(1);
		expect((changes[0]!.next as { color: string }).color).toBe('#00ff88');
	});

	it('offers nothing for a key the author has claimed as an override', () => {
		const entries = styleSet();
		const composition = applyGraphicStyleSet(
			graphic([textItem({ styleRefs: { typography: { entryId: 'heading', overrides: { fontSize: 32 } } } })]),
			resolveGraphicStyleSet(entries),
		);

		// The preset's size moved; the author owns that key, so nothing changes for them.
		expect(graphicStyleUpdateChanges(composition, resolveGraphicStyleSet(styleSet('#ff0044', 96))))
			.toEqual([]);
		// A key they did not claim still moves.
		expect(graphicStyleUpdateChanges(composition, resolveGraphicStyleSet(styleSet('#00ff88', 96))))
			.toHaveLength(1);
	});

	it('survives a round trip through JSON, where key order is not preserved', () => {
		const entries = styleSet();
		const stored = JSON.parse(JSON.stringify(applied(entries))) as BroadcastGraphicConfig;

		expect(graphicStyleUpdateChanges(stored, resolveGraphicStyleSet(entries))).toEqual([]);
	});
});

describe('detachGraphicStyleRefs', () => {
	it('drops the reference and keeps the value it produced', () => {
		const composition = applyGraphicStyleSet(
			graphic([textItem({ styleRefs: { typography: { entryId: 'heading' } } })]),
			resolveGraphicStyleSet(styleSet()),
		);

		const detached = detachGraphicStyleRefs(composition, ['heading']);

		expect(headlineOf(detached).typography).toEqual(headlineOf(composition).typography);
		expect(headlineOf(detached).styleRefs).toBeUndefined();
	});

	it('leaves references to other entries in place', () => {
		const composition = graphic([textItem({
			styleRefs: {
				'typography': { entryId: 'heading' },
				'animation.enter': { entryId: 'rise' },
			},
		})]);

		const detached = detachGraphicStyleRefs(composition, ['heading']);

		expect(headlineOf(detached).styleRefs).toEqual({ 'animation.enter': { entryId: 'rise' } });
	});

	it('detaches from the Style Set entirely when no entries are named', () => {
		const composition = graphic(
			[textItem({ styleRefs: { typography: { entryId: 'heading' } } })],
			{ styleRefs: { 'animation.enter': { entryId: 'rise' } } },
		);

		const detached = detachGraphicStyleRefs(composition, null);

		expect(detached.styleSet).toBeUndefined();
		expect(detached.styleRefs).toBeUndefined();
		expect(headlineOf(detached).styleRefs).toBeUndefined();
		// And nothing about what it renders moved.
		expect(headlineOf(detached).typography).toEqual(headlineOf(composition).typography);
	});
});

describe('replaceGraphicStyleRefs', () => {
	it('repoints every reference to one entry and carries the overrides with it', () => {
		const composition = graphic([textItem({
			styleRefs: { typography: { entryId: 'heading', overrides: { fontSize: 32 } } },
		})]);

		const replaced = replaceGraphicStyleRefs(composition, 'heading', 'subheading');

		expect(headlineOf(replaced).styleRefs?.typography)
			.toEqual({ entryId: 'subheading', overrides: { fontSize: 32 } });
	});
});

describe('captureGraphicStyleOverrides', () => {
	it('turns an edit to an inherited property into an explicit override', () => {
		const resolution = resolveGraphicStyleSet(styleSet());
		const edited = { ...TYPOGRAPHY, fontSize: 30, fontWeight: 800, textTransform: 'uppercase' as const, letterSpacing: 2, lineHeight: 1, color: '#ff0044' };

		expect(captureGraphicStyleOverrides(resolution, 'typography', 'heading', edited))
			.toEqual({ fontSize: 30 });
	});

	it('records nothing when the property matches the preset again', () => {
		const resolution = resolveGraphicStyleSet(styleSet());
		const matching = {
			...TYPOGRAPHY,
			fontSize: 64,
			fontWeight: 800,
			textTransform: 'uppercase' as const,
			letterSpacing: 2,
			lineHeight: 1,
			color: '#ff0044',
		};

		expect(captureGraphicStyleOverrides(resolution, 'typography', 'heading', matching)).toBeUndefined();
	});
});

describe('graphicStyleSetEntryIdsInDocument', () => {
	it('names every entry a composition references, from items, group children, and the graphic itself', () => {
		const group: GraphicItemConfig = {
			type: 'group',
			id: 'cluster',
			label: 'Cluster',
			visible: true,
			anchor: 'top-left',
			x: 0,
			y: 0,
			width: 400,
			height: 200,
			arrangement: 'row',
			padding: 0,
			gap: 0,
			align: 'center',
			justify: 'start',
			clip: false,
			geometry: squareShapeGeometry(),
			children: [textItem({ id: 'child', styleRefs: { typography: { entryId: 'heading' } } })],
			styleRefs: { geometry: { entryId: 'cut-corner' } },
		};

		const ids = graphicStyleSetEntryIdsInDocument(graphic(
			[group],
			{ styleRefs: { 'animation.enter': { entryId: 'rise' } } },
		));

		expect([...ids].sort()).toEqual(['cut-corner', 'heading', 'rise']);
	});
});
