import type { ResolvedGraphicStyleMediaTreatment } from '~~/shared/modules/graphic-style-sets';
import type {
	BroadcastGraphicConfig,
	GraphicAnimationRecipe,
	GraphicItemConfig,
	GraphicOnScreenAnimationRecipe,
	GraphicSurfaceStyle,
	TextGraphicItemConfig,
} from '~~/shared/types/graphics';
import type { GraphicStyleSetEntry } from '~~/shared/types/graphicStyleSet';
import { describe, expect, it } from 'vitest';
import {
	applyGraphicStyleSet,
	bindGraphicStyleRef,
	captureGraphicStyleOverrides,
	detachGraphicStyleRefs,
	GRAPHIC_STYLE_SLOT_OWNED_KEYS,
	graphicStyleChangedKeys,
	graphicStyleChangeKey,
	graphicStyleOwnerSupportsSlot,
	graphicStyleSetEntryIdsInDocument,
	graphicStyleUpdateChanges,
	recaptureGraphicStyleOverrides,
	replaceGraphicStyleRefs,
	resolveGraphicStyleSet,
	unbindGraphicStyleRef,
} from '~~/shared/modules/graphic-style-sets';
import { squareShapeGeometry } from '~~/shared/modules/graphics';
import { GRAPHIC_STYLE_SLOT_VALUES } from '~~/shared/types/graphicStyleSet';

// A composition holds its own resolved values; republishing offers an update only to
// what references the entry; applying preserves local overrides; detaching drops provenance.

function entry<T extends GraphicStyleSetEntry['kind']>(
	kind: T,
	id: string,
	value: Extract<GraphicStyleSetEntry, { kind: T }>['value'],
): GraphicStyleSetEntry {
	return {
		id,
		kind,
		name: id,
		schemaVersion: 1,
		value,
	} as GraphicStyleSetEntry;
}

const TYPOGRAPHY = {
	font: { kind: 'application', fontId: 'inter' } as const,
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
			font: { kind: 'application', fontId: 'inter' },
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

/** A typography in step with the `heading` entry, so one edited value is the only deviation. */
function inheritedTypography(brandColor = '#ff0044', headingSize = 64) {
	return {
		...TYPOGRAPHY,
		fontSize: headingSize,
		fontWeight: 800,
		textTransform: 'uppercase' as const,
		letterSpacing: 2,
		lineHeight: 1,
		color: brandColor,
	};
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

describe('gRAPHIC_STYLE_SLOT_OWNED_KEYS', () => {
	// Each owned-key list is pinned against a `Required<…>` maximal value of its property group,
	// so a field added to the group fails to typecheck until it is capturable as an override.
	it('names exactly the keys of the property group each slot inherits', () => {
		const surface: Required<GraphicSurfaceStyle> = {
			fill: { type: 'solid', color: '#101014' },
			fillOpacity: 0.9,
			outline: { color: '#ffffff', width: 2 },
			glow: { color: '#ff0044', size: 8, opacity: 0.5 },
		};
		const media: Required<ResolvedGraphicStyleMediaTreatment> = {
			fit: 'cover',
			focalPosition: { horizontal: 0.5, vertical: 0.5 },
			opacity: 1,
			clipGeometry: squareShapeGeometry(),
			playbackRate: 1,
			loop: true,
		};
		const recipe: Required<GraphicAnimationRecipe> = {
			duration: 320,
			easing: 'ease-out',
			delay: 0,
			fade: { opacity: 0 },
			slide: { direction: 'north', distanceMode: 'fixed', distance: 40 },
			scale: { factor: 0.9, origin: 'center' },
			reveal: { edge: 'bottom' },
		};
		const onScreenRecipe: Required<GraphicOnScreenAnimationRecipe> = {
			...recipe,
			pause: 1000,
			repeat: 'indefinite',
		};

		const surfaceKeys = Object.keys(surface);
		const geometryKeys = Object.keys(squareShapeGeometry());
		const mediaKeys = Object.keys(media);
		const recipeKeys = Object.keys(recipe);

		// Typography less the one key that stays item-specific.
		expect([...GRAPHIC_STYLE_SLOT_OWNED_KEYS.typography].sort())
			.toEqual(Object.keys(TYPOGRAPHY).filter(key => key !== 'textAlign').sort());
		expect([...GRAPHIC_STYLE_SLOT_OWNED_KEYS.surfaceStyle].sort()).toEqual([...surfaceKeys].sort());
		for (const slot of ['defaultChildSurfaceStyle', 'boxSurfaceStyle', 'wonBoxSurfaceStyle'] as const)
			expect([...GRAPHIC_STYLE_SLOT_OWNED_KEYS[slot]].sort()).toEqual([...surfaceKeys].sort());
		expect([...GRAPHIC_STYLE_SLOT_OWNED_KEYS.geometry].sort()).toEqual([...geometryKeys].sort());
		for (const slot of ['clipGeometry', 'boxGeometry'] as const)
			expect([...GRAPHIC_STYLE_SLOT_OWNED_KEYS[slot]].sort()).toEqual([...geometryKeys].sort());
		expect([...GRAPHIC_STYLE_SLOT_OWNED_KEYS.media].sort()).toEqual([...mediaKeys].sort());
		for (const phase of ['animation.enter', 'animation.update', 'animation.exit'] as const)
			expect([...GRAPHIC_STYLE_SLOT_OWNED_KEYS[phase]].sort()).toEqual([...recipeKeys].sort());
		// Only the on-screen phase cycles, so only it owns the repetition defaults.
		expect([...GRAPHIC_STYLE_SLOT_OWNED_KEYS['animation.on-screen']].sort())
			.toEqual(Object.keys(onScreenRecipe).sort());
		// A Graphic Fill is a discriminated union, so it has no partial to deviate in.
		expect(GRAPHIC_STYLE_SLOT_OWNED_KEYS['surfaceStyle.fill']).toEqual([]);
	});

	it('inherits typography into a Deck List Item and offers it no surface', () => {
		// A Deck List renders cards rather than painting a surface, so typography is
		// the one property group a Style Set can reach.
		const deckList = { type: 'deck-list' } as GraphicItemConfig;

		expect(graphicStyleOwnerSupportsSlot(deckList, 'typography')).toBe(true);
		expect(graphicStyleOwnerSupportsSlot(deckList, 'surfaceStyle')).toBe(false);
		expect(graphicStyleOwnerSupportsSlot(deckList, 'geometry')).toBe(false);
	});

	it('gives every slot in the vocabulary a list', () => {
		expect(Object.keys(GRAPHIC_STYLE_SLOT_OWNED_KEYS).sort())
			.toEqual([...GRAPHIC_STYLE_SLOT_VALUES].sort());
	});
});

describe('applyGraphicStyleSet', () => {
	it('writes a typography entry\'s resolved properties into the item and leaves the item-specific ones alone', () => {
		const composition = graphic([
			textItem({
				styleRefs: {
					typography: { entryId: 'heading' },
				},
			}),
		]);

		const applied = applyGraphicStyleSet(composition, resolveGraphicStyleSet(styleSet()));

		expect(headlineOf(applied).typography).toEqual({
			font: { kind: 'application', fontId: 'inter' },
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

	it('preserves a local property-level override on top of the entry', () => {
		const composition = graphic([
			textItem({
				styleRefs: {
					typography: {
						entryId: 'heading',
						overrides: { fontSize: 32 },
					},
				},
			}),
		]);

		const applied = applyGraphicStyleSet(composition, resolveGraphicStyleSet(styleSet('#ff0044', 96)));

		expect(headlineOf(applied).typography).toMatchObject({
			// The entry moved to 96 and the author's own 32 still wins.
			fontSize: 32,
			// Everything they did not claim followed the entry.
			color: '#ff0044',
			letterSpacing: 2,
		});
	});

	it('removes an inherited glow the Graphic Surface Style entry no longer carries', () => {
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
			styleRefs: {
				surfaceStyle: { entryId: 'panel' },
			},
		};
		const withoutGlow = styleSet().map(candidate => candidate.id === 'panel'
			? entry('surface-style', 'panel', { fillEntryId: 'panel-fill', fillOpacity: 0.9 })
			: candidate);

		const applied = applyGraphicStyleSet(graphic([shape]), resolveGraphicStyleSet(withoutGlow));

		// A merge would have left the glow behind, which would make an entry unable to
		// take back something it once gave.
		expect(applied.items[0]).not.toHaveProperty('glow');
		expect((applied.items[0] as { surfaceStyle?: { glow?: unknown } }).surfaceStyle?.glow).toBeUndefined();
	});

	it('keeps the item\'s own fill when the Graphic Surface Style entry names no Graphic Fill entry', () => {
		const outlineOnly = [
			...styleSet(),
			entry('surface-style', 'edge', {
				fillOpacity: 1,
				outline: { colorEntryId: 'brand', width: 4 },
			}),
		];
		const composition = graphic([
			textItem({
				surfaceStyle: {
					fill: { type: 'solid', color: '#00ff88' },
					fillOpacity: 1,
				},
				styleRefs: {
					surfaceStyle: { entryId: 'edge' },
				},
			}),
		]);

		const applied = applyGraphicStyleSet(composition, resolveGraphicStyleSet(outlineOnly));

		expect(headlineOf(applied).surfaceStyle).toEqual({
			fill: { type: 'solid', color: '#00ff88' },
			fillOpacity: 1,
			outline: { color: '#ff0044', width: 4 },
		});
	});

	it('lets the finer Graphic Fill reference win over the Graphic Surface Style entry carrying one', () => {
		const entries = [
			...styleSet(),
			entry('fill', 'accent-fill', { type: 'solid', colorEntryId: 'brand' }),
		];
		const composition = graphic([
			textItem({
				surfaceStyle: {
					fill: { type: 'solid', color: '#000000' },
					fillOpacity: 1,
				},
				styleRefs: {
					'surfaceStyle': { entryId: 'panel' },
					'surfaceStyle.fill': { entryId: 'accent-fill' },
				},
			}),
		]);

		const applied = applyGraphicStyleSet(composition, resolveGraphicStyleSet(entries));

		expect(headlineOf(applied).surfaceStyle).toMatchObject({
			// The surface entry's own fill is `panel-fill` (ink); the item said something
			// more specific about the fill alone.
			fill: { type: 'solid', color: '#ff0044' },
			fillOpacity: 0.9,
		});
	});

	it('writes a Graphic Animation Recipe entry into the phase its slot names, without on-screen repetition', () => {
		const composition = graphic(
			[
				textItem({
					styleRefs: {
						'animation.enter': { entryId: 'rise' },
					},
				}),
			],
			{
				styleRefs: {
					'animation.exit': { entryId: 'rise' },
				},
			},
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

	it('carries an on-screen entry\'s repetition defaults only into the on-screen phase', () => {
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
		const composition = graphic([
			textItem({
				styleRefs: {
					'animation.on-screen': { entryId: 'pulse' },
				},
			}),
		]);

		const applied = applyGraphicStyleSet(composition, resolveGraphicStyleSet(pulsing));

		expect(headlineOf(applied).animation?.['on-screen'])
			.toMatchObject({ pause: 400, repeat: 'indefinite' });
	});

	it('leaves a reference the Style Set can no longer honour exactly as it is', () => {
		const composition = graphic([
			textItem({
				styleRefs: {
					typography: { entryId: 'heading' },
				},
			}),
		]);

		// A Style Set that failed to load must not quietly turn a linked composition local.
		const applied = applyGraphicStyleSet(composition, resolveGraphicStyleSet([]));

		expect(headlineOf(applied).typography).toEqual(TYPOGRAPHY);
		expect(headlineOf(applied).styleRefs).toEqual({
			typography: { entryId: 'heading' },
		});
	});

	it('inherits each of a Game Wins item\'s three surfaces independently', () => {
		const surface = {
			fill: { type: 'solid' as const, color: '#000000' },
			fillOpacity: 1,
		};
		const gameWins: GraphicItemConfig = {
			type: 'game-wins',
			id: 'wins',
			label: 'Game wins',
			visible: true,
			anchor: 'top-left',
			x: 0,
			y: 0,
			width: 200,
			height: 40,
			playerSide: 'player1',
			displayMode: 'boxes',
			boxOrientation: 'horizontal',
			boxWidth: 24,
			boxHeight: 24,
			boxGap: 4,
			boxGeometry: squareShapeGeometry(),
			boxSurfaceStyle: { ...surface },
			wonBoxSurfaceStyle: { ...surface },
			typography: { ...TYPOGRAPHY },
			styleRefs: {
				wonBoxSurfaceStyle: { entryId: 'panel' },
				boxGeometry: { entryId: 'cut-corner' },
			},
		};

		const applied = applyGraphicStyleSet(graphic([gameWins]), resolveGraphicStyleSet(styleSet()));

		const item = applied.items[0];
		if (item?.type !== 'game-wins')
			throw new Error('expected the Game Wins Graphic Item');
		// The won box is the whole point of the item: it has to be able to say something
		// different from the unwon one, so the two surfaces are separate slots rather
		// than one "this item's surface".
		expect(item.wonBoxSurfaceStyle).toMatchObject({
			fill: { type: 'solid', color: '#101014' },
			fillOpacity: 0.9,
			glow: { color: '#ff0044', size: 8, opacity: 0.5 },
		});
		expect(item.boxSurfaceStyle).toEqual(surface);
		expect(item.surfaceStyle).toBeUndefined();
		// And its win-box geometry, which shapes one box rather than the indicator.
		expect(item.boxGeometry).toMatchObject({
			topRight: { treatment: 'cut', size: 24 },
		});
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
			styleRefs: {
				typography: { entryId: 'heading' },
			},
		};

		const applied = applyGraphicStyleSet(graphic([media]), resolveGraphicStyleSet(styleSet()));

		expect(applied.items[0]).not.toHaveProperty('typography');
	});

	it('records the revision the composition has been reconciled to', () => {
		const composition = graphic([
			textItem({
				styleRefs: {
					typography: { entryId: 'heading' },
				},
			}),
		]);

		const applied = applyGraphicStyleSet(composition, resolveGraphicStyleSet(styleSet()), { revision: 7 });

		expect(applied.styleSet).toEqual({ styleSetId: 'show-style', revision: 7 });
	});

	it('preserves the previously resolved property as a new local override when review says so', () => {
		const composition = graphic([
			textItem({
				typography: { ...TYPOGRAPHY, fontSize: 64, color: '#ff0044' },
				styleRefs: {
					typography: { entryId: 'heading' },
				},
			}),
		]);

		const applied = applyGraphicStyleSet(
			composition,
			resolveGraphicStyleSet(styleSet('#00ff88', 96)),
			{
				decisions: { [graphicStyleChangeKey('headline', 'typography')]: 'keep-as-override' },
			},
		);

		// The property did not move…
		expect(headlineOf(applied).typography).toMatchObject({ fontSize: 64, color: '#ff0044' });
		// …and it will not move on the next republish either, because it is now the
		// author's own.
		expect(headlineOf(applied).styleRefs?.typography?.overrides)
			.toMatchObject({ fontSize: 64, color: '#ff0044' });
		expect(headlineOf(applied).styleRefs?.typography?.entryId).toBe('heading');
	});

	// "Keep mine" pins the keys the author deviates in, not the whole group (#162).
	it('pins only the keys the author deviates in, not the whole property group', () => {
		// Behind the published revision, an author's own edit records no override — so
		// what they wrote lives inline and nothing but this decision preserves it.
		const composition = graphic([
			textItem({
				typography: {
					...inheritedTypography(),
					fontSize: 30,
				},
				styleRefs: {
					typography: { entryId: 'heading' },
				},
			}),
		]);

		const applied = applyGraphicStyleSet(
			composition,
			resolveGraphicStyleSet(styleSet('#ff0044', 99)),
			{
				decisions: { [graphicStyleChangeKey('headline', 'typography')]: 'keep-as-override' },
			},
		);

		// The one key the author wrote, and only it. Everything else keeps inheriting, so
		// the next republish still reaches this slot.
		expect(headlineOf(applied).styleRefs?.typography?.overrides).toEqual({ fontSize: 30 });
	});

	it('keeps an override the author already had when a different key moves', () => {
		const composition = graphic([
			textItem({
				typography: {
					...inheritedTypography(),
					fontSize: 30,
				},
				styleRefs: {
					typography: {
						entryId: 'heading',
						overrides: { fontSize: 30 },
					},
				},
			}),
		]);

		// The palette moves the typography entry's colour; the size the author already
		// pinned does not move at all.
		const applied = applyGraphicStyleSet(
			composition,
			resolveGraphicStyleSet(styleSet('#00ff88')),
			{
				decisions: { [graphicStyleChangeKey('headline', 'typography')]: 'keep-as-override' },
			},
		);

		// Both are the author's: one they had pinned, one they are pinning now. Narrowing
		// to "the keys that moved" alone would have dropped the first.
		expect(headlineOf(applied).styleRefs?.typography?.overrides)
			.toEqual({ fontSize: 30, color: '#ff0044' });
	});

	/** A slot the author has kept offers nothing further, which is what settles it. */
	it('leaves no update outstanding on a slot the author kept', () => {
		const republished = styleSet('#ff0044', 99);
		const composition = graphic([
			textItem({
				typography: {
					...inheritedTypography(),
					fontSize: 30,
				},
				styleRefs: {
					typography: { entryId: 'heading' },
				},
			}),
		]);

		const applied = applyGraphicStyleSet(
			composition,
			resolveGraphicStyleSet(republished),
			{
				decisions: { [graphicStyleChangeKey('headline', 'typography')]: 'keep-as-override' },
			},
		);

		expect(graphicStyleUpdateChanges(applied, resolveGraphicStyleSet(republished))).toEqual([]);
	});

	// A pin is the author's claim on a property even when the republished entry agrees with it.
	it('keeps a pin the republished entry happens to agree with', () => {
		const composition = graphic([
			textItem({
				typography: {
					...inheritedTypography(),
					fontSize: 30,
				},
				styleRefs: {
					typography: {
						entryId: 'heading',
						overrides: { fontSize: 30 },
					},
				},
			}),
		]);

		// The republished entry moves the colour and lands on the author's own size.
		const applied = applyGraphicStyleSet(
			composition,
			resolveGraphicStyleSet(styleSet('#00ff88', 30)),
			{
				decisions: { [graphicStyleChangeKey('headline', 'typography')]: 'keep-as-override' },
			},
		);

		expect(headlineOf(applied).styleRefs?.typography?.overrides)
			.toEqual({ fontSize: 30, color: '#ff0044' });
	});

	// A stale override describing a value the owner no longer holds pins nothing.
	it('pins nothing when a slot holds the entry and only a stale override disagrees', () => {
		const composition = graphic([
			textItem({
				typography: inheritedTypography(),
				styleRefs: {
					typography: {
						entryId: 'heading',
						overrides: { fontSize: 999 },
					},
				},
			}),
		]);

		const applied = applyGraphicStyleSet(
			composition,
			resolveGraphicStyleSet(styleSet()),
			{
				decisions: { [graphicStyleChangeKey('headline', 'typography')]: 'keep-as-override' },
			},
		);

		expect(headlineOf(applied).styleRefs?.typography?.overrides).toEqual({});
		// And the row is settled rather than offered again on every later review.
		expect(graphicStyleUpdateChanges(applied, resolveGraphicStyleSet(styleSet()))).toEqual([]);
	});

	it('names the keys of a change an author is deciding about', () => {
		expect(graphicStyleChangedKeys(
			{ fontSize: 30, color: '#ffffff', letterSpacing: 2 },
			{ fontSize: 99, color: '#ffffff', letterSpacing: 4 },
		)).toEqual(['fontSize', 'letterSpacing']);

		// A property group that arrives where there was none is every key it carries.
		expect(graphicStyleChangedKeys(null, { fit: 'cover', opacity: 1 }))
			.toEqual(['fit', 'opacity']);
	});

	it('keeps a Graphic Fill slot\'s value by letting go of the reference', () => {
		const entries = [
			...styleSet(),
			entry('fill', 'accent-fill', { type: 'solid', colorEntryId: 'brand' }),
		];
		const composition = applyGraphicStyleSet(
			graphic([
				textItem({
					surfaceStyle: {
						fill: { type: 'solid', color: '#000000' },
						fillOpacity: 1,
					},
					styleRefs: {
						'surfaceStyle.fill': { entryId: 'accent-fill' },
					},
				}),
			]),
			resolveGraphicStyleSet(entries),
		);

		const applied = applyGraphicStyleSet(
			composition,
			resolveGraphicStyleSet([
				...styleSet('#00ff88'),
				entry('fill', 'accent-fill', { type: 'solid', colorEntryId: 'brand' }),
			]),
			{
				decisions: { [graphicStyleChangeKey('headline', 'surfaceStyle.fill')]: 'keep-as-override' },
			},
		);

		// A Graphic Fill has no partial to record a deviation in, so keeping it means the
		// property goes local. Recording an empty override instead would leave the
		// reference in place and offer the same change again on every later review.
		expect(headlineOf(applied).surfaceStyle?.fill).toEqual({ type: 'solid', color: '#ff0044' });
		expect(headlineOf(applied).styleRefs?.['surfaceStyle.fill']).toBeUndefined();
		expect(graphicStyleUpdateChanges(
			applied,
			resolveGraphicStyleSet([
				...styleSet('#00ff88'),
				entry('fill', 'accent-fill', { type: 'solid', colorEntryId: 'brand' }),
			]),
		)).toEqual([]);
	});

	it('never mutates the composition it was given', () => {
		const composition = graphic([
			textItem({
				styleRefs: {
					typography: { entryId: 'heading' },
				},
			}),
		]);

		applyGraphicStyleSet(composition, resolveGraphicStyleSet(styleSet()));

		expect(headlineOf(composition).typography).toEqual(TYPOGRAPHY);
	});
});

describe('graphicStyleUpdateChanges', () => {
	function applied(entries: GraphicStyleSetEntry[]): BroadcastGraphicConfig {
		return applyGraphicStyleSet(
			graphic([
				textItem({
					styleRefs: {
						typography: { entryId: 'heading' },
					},
				}),
			]),
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
			candidate.id === 'heading'
				? { ...candidate, name: 'Show heading' }
				: candidate,
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
			graphic([
				textItem({
					styleRefs: {
						typography: {
							entryId: 'heading',
							overrides: { fontSize: 32 },
						},
					},
				}),
			]),
			resolveGraphicStyleSet(entries),
		);

		// The entry's size moved; the author owns that key, so nothing changes for them.
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
			graphic([
				textItem({
					styleRefs: {
						typography: { entryId: 'heading' },
					},
				}),
			]),
			resolveGraphicStyleSet(styleSet()),
		);

		const detached = detachGraphicStyleRefs(composition, ['heading']);

		expect(headlineOf(detached).typography).toEqual(headlineOf(composition).typography);
		expect(headlineOf(detached).styleRefs).toBeUndefined();
	});

	it('leaves references to other entries in place', () => {
		const composition = graphic([
			textItem({
				styleRefs: {
					'typography': { entryId: 'heading' },
					'animation.enter': { entryId: 'rise' },
				},
			}),
		]);

		const detached = detachGraphicStyleRefs(composition, ['heading']);

		expect(headlineOf(detached).styleRefs).toEqual({
			'animation.enter': { entryId: 'rise' },
		});
	});

	it('detaches from the Style Set entirely when no entries are named', () => {
		const composition = graphic(
			[
				textItem({
					styleRefs: {
						typography: { entryId: 'heading' },
					},
				}),
			],
			{
				styleRefs: {
					'animation.enter': { entryId: 'rise' },
				},
			},
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
		const composition = graphic([
			textItem({
				styleRefs: {
					typography: {
						entryId: 'heading',
						overrides: { fontSize: 32 },
					},
				},
			}),
		]);

		const replaced = replaceGraphicStyleRefs(composition, 'heading', 'subheading');

		expect(headlineOf(replaced).styleRefs?.typography)
			.toEqual({
				entryId: 'subheading',
				overrides: { fontSize: 32 },
			});
	});
});

describe('captureGraphicStyleOverrides', () => {
	it('turns an edit to an inherited property into an explicit override', () => {
		const resolution = resolveGraphicStyleSet(styleSet());
		const edited = {
			...TYPOGRAPHY,
			fontSize: 30,
			fontWeight: 800,
			textTransform: 'uppercase' as const,
			letterSpacing: 2,
			lineHeight: 1,
			color: '#ff0044',
		};

		expect(captureGraphicStyleOverrides(resolution, 'typography', 'heading', edited))
			.toEqual({ fontSize: 30 });
	});

	it('records nothing when the property matches the entry again', () => {
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

describe('recaptureGraphicStyleOverrides', () => {
	const withAccentFill = [
		...styleSet(),
		entry('fill', 'accent-fill', { type: 'solid', colorEntryId: 'brand' }),
	];
	/** The revision every composition here is linked at. */
	const LINKED = 1;
	/** A publish this composition has not reconciled to: `brand` moved, so the colour and fill do. */
	const republished = [
		...styleSet('#00ff88'),
		entry('fill', 'accent-fill', { type: 'solid', colorEntryId: 'brand' }),
	];
	const AHEAD = LINKED + 1;

	/** One composition whose Graphic Fill is inherited from `accent-fill`. */
	function boundFill(): BroadcastGraphicConfig {
		return applyGraphicStyleSet(
			graphic([
				textItem({
					surfaceStyle: {
						fill: { type: 'solid', color: '#000000' },
						fillOpacity: 1,
					},
					styleRefs: {
						'surfaceStyle.fill': { entryId: 'accent-fill' },
					},
				}),
			]),
			resolveGraphicStyleSet(withAccentFill),
		);
	}

	/** One composition inheriting both a typography entry and a Graphic Fill. */
	function boundBoth(): BroadcastGraphicConfig {
		return applyGraphicStyleSet(
			graphic([
				textItem({
					surfaceStyle: {
						fill: { type: 'solid', color: '#000000' },
						fillOpacity: 1,
					},
					styleRefs: {
						'typography': { entryId: 'heading' },
						'surfaceStyle.fill': { entryId: 'accent-fill' },
					},
				}),
			]),
			resolveGraphicStyleSet(withAccentFill),
		);
	}

	/** A property control writing a size, which is what makes a recapture run. */
	function editFontSize(composition: BroadcastGraphicConfig, fontSize: number): BroadcastGraphicConfig {
		return {
			...composition,
			items: composition.items.map(item => item.type === 'text'
				? {
						...item,
						typography: { ...item.typography, fontSize },
					}
				: item),
		};
	}

	/** An edit to the one typography key the slot does not own: it recaptures without touching the entry's keys. */
	function editTextAlign(composition: BroadcastGraphicConfig, textAlign: 'left' | 'center'): BroadcastGraphicConfig {
		return {
			...composition,
			items: composition.items.map(item => item.id === 'headline' && item.type === 'text'
				? {
						...item,
						typography: { ...item.typography, textAlign },
					}
				: item),
		};
	}

	/** The fill control writing a value, which is all a property control ever does. */
	function paintFill(composition: BroadcastGraphicConfig, color: string): BroadcastGraphicConfig {
		return {
			...composition,
			items: composition.items.map((item) => {
				if (item.id !== 'headline' || item.type !== 'text')
					return item;
				return {
					...item,
					surfaceStyle: {
						...item.surfaceStyle!,
						fill: { type: 'solid' as const, color },
					},
				};
			}),
		};
	}

	it('turns an edit to an inherited typography property into an explicit override', () => {
		const resolution = resolveGraphicStyleSet(styleSet());
		const composition = applyGraphicStyleSet(
			graphic([
				textItem({
					styleRefs: {
						typography: { entryId: 'heading' },
					},
				}),
			]),
			resolution,
		);

		const recaptured = recaptureGraphicStyleOverrides(
			editFontSize(composition, 30),
			resolution,
			LINKED,
			composition,
		);

		expect(headlineOf(recaptured).styleRefs?.typography)
			.toEqual({
				entryId: 'heading',
				overrides: { fontSize: 30 },
			});
	});

	it('lets go of a Graphic Fill reference the author has painted over', () => {
		const resolution = resolveGraphicStyleSet(withAccentFill);
		const composition = boundFill();
		const edited = paintFill(composition, '#00ff88');

		const recaptured = recaptureGraphicStyleOverrides(edited, resolution, LINKED, composition);

		// A Graphic Fill is a discriminated union with no partial to record a deviation
		// in, so deviating from the entry is unbinding it — the same answer "Keep mine"
		// gives during review. The value is already inline, so only the provenance moves.
		expect(headlineOf(recaptured).surfaceStyle?.fill).toEqual({ type: 'solid', color: '#00ff88' });
		expect(headlineOf(recaptured).styleRefs?.['surfaceStyle.fill']).toBeUndefined();
		// And the badge stops reporting an update the author has already acted on. A
		// reference kept here would offer this same change on every later review, with no
		// answer that ever settles it.
		expect(graphicStyleUpdateChanges(recaptured, resolution)).toEqual([]);
	});

	it('keeps a Graphic Fill reference the author has left where the entry put it', () => {
		const resolution = resolveGraphicStyleSet(withAccentFill);
		const composition = boundFill();

		const recaptured = recaptureGraphicStyleOverrides(composition, resolution, LINKED, composition);

		expect(headlineOf(recaptured).styleRefs?.['surfaceStyle.fill']).toEqual({ entryId: 'accent-fill' });
	});

	it('keeps a Graphic Fill reference the author has edited back to the entry\'s own value', () => {
		const resolution = resolveGraphicStyleSet(withAccentFill);
		const wandered = paintFill(boundFill(), '#00ff88');

		const recaptured = recaptureGraphicStyleOverrides(paintFill(wandered, '#ff0044'), resolution, LINKED, wandered);

		// Nothing about it deviates, so nothing about it is theirs — exactly as an edited
		// and restored font size leaves no override pinning it.
		expect(headlineOf(recaptured).styleRefs?.['surfaceStyle.fill']).toEqual({ entryId: 'accent-fill' });
	});

	it('still offers a republished Graphic Fill to an author who never touched theirs', () => {
		const resolution = resolveGraphicStyleSet(withAccentFill);
		// An edit somewhere else on the same item, which is what runs a recapture.
		const composition = boundFill();
		const edited = editFontSize(composition, 30);

		const recaptured = recaptureGraphicStyleOverrides(edited, resolution, LINKED, composition);
		const changes = graphicStyleUpdateChanges(recaptured, resolveGraphicStyleSet(republished));

		// The reference survived an unrelated edit, so the Style Set can still reach it —
		// and reaching it is still an offer to review rather than a mutation.
		expect(changes).toHaveLength(1);
		expect(changes[0]).toMatchObject({ slot: 'surfaceStyle.fill', entryId: 'accent-fill' });
		expect(changes[0]!.next).toEqual({ type: 'solid', color: '#00ff88' });
	});

	// An over-broad pin from before #162 survives an edit at full width; the key the author
	// moves is re-pinned at its new value rather than released (#167, #229, ADR-0006).
	it('keeps all eight keys of an over-broad pin, re-pinning the one the author moves', () => {
		const resolution = resolveGraphicStyleSet(styleSet());
		const inStep = inheritedTypography();
		// What the pre-#162 "Keep mine" recorded: the whole property group, every key of
		// it agreeing with the entry the composition is in step with.
		const wholeGroup = Object.fromEntries(
			GRAPHIC_STYLE_SLOT_OWNED_KEYS.typography.map(key => [key, inStep[key as keyof typeof inStep]]),
		);
		const overPinned = graphic([
			textItem({
				typography: inStep,
				styleRefs: {
					typography: { entryId: 'heading', overrides: wholeGroup },
				},
			}),
		]);

		const recaptured = recaptureGraphicStyleOverrides(editFontSize(overPinned, 30), resolution, LINKED, overPinned);

		expect(headlineOf(recaptured).styleRefs?.typography)
			.toEqual({
				entryId: 'heading',
				overrides: { ...wholeGroup, fontSize: 30 },
			});
		// Still eight keys wide, so every one of them goes on inheriting nothing. That is
		// the cost ADR-0006's Consequences names rather than the narrowing it used to.
		expect(Object.keys(headlineOf(recaptured).styleRefs!.typography!.overrides!)).toHaveLength(8);
		expect(graphicStyleUpdateChanges(recaptured, resolveGraphicStyleSet(styleSet('#00ff88')))).toEqual([]);
	});

	// Landing a key exactly on the entry's value is the only edit that releases it.
	it('releases one key of an over-broad pin when the author lands it back on the entry\'s value', () => {
		const resolution = resolveGraphicStyleSet(styleSet());
		const inStep = inheritedTypography();
		const wholeGroup = Object.fromEntries(
			GRAPHIC_STYLE_SLOT_OWNED_KEYS.typography.map(key => [key, inStep[key as keyof typeof inStep]]),
		);
		const overPinned = graphic([
			textItem({
				typography: inStep,
				styleRefs: {
					typography: { entryId: 'heading', overrides: wholeGroup },
				},
			}),
		]);

		const moved = recaptureGraphicStyleOverrides(editFontSize(overPinned, 30), resolution, LINKED, overPinned);
		// Back onto the entry's own size, which is what `styleSet()` resolves `heading` to.
		const landed = recaptureGraphicStyleOverrides(editFontSize(moved, 64), resolution, LINKED, moved);

		const { fontSize: _released, ...stillPinned } = wholeGroup;
		expect(headlineOf(landed).styleRefs?.typography).toEqual({ entryId: 'heading', overrides: stillPinned });
		// And no review row ever offered that 64, because a fully pinned slot resolves to
		// what the owner already holds — so nothing on screen names the value to land on.
		expect(graphicStyleUpdateChanges(overPinned, resolveGraphicStyleSet(styleSet('#ff0044', 99)))).toEqual([]);
	});

	// Unbinding and rebinding the slot is the reset ADR-0006 names for a whole pin.
	it('clears an over-broad pin when the slot is unbound and bound again', () => {
		const inStep = inheritedTypography();
		const overPinned = graphic([
			textItem({
				typography: inStep,
				styleRefs: {
					typography: {
						entryId: 'heading',
						overrides: Object.fromEntries(
							GRAPHIC_STYLE_SLOT_OWNED_KEYS.typography.map(key => [key, inStep[key as keyof typeof inStep]]),
						),
					},
				},
			}),
		]);
		const republished = resolveGraphicStyleSet(styleSet('#ff0044', 99));

		const rebound = bindGraphicStyleRef(
			unbindGraphicStyleRef(overPinned, 'headline', 'typography'),
			'headline',
			'typography',
			'heading',
			republished,
		);

		expect(headlineOf(rebound).styleRefs?.typography).toEqual({ entryId: 'heading' });
		expect(headlineOf(rebound).typography.fontSize).toBe(99);
	});

	// With no entry resolved there is nothing to diff against, so recorded overrides survive.
	it('keeps the overrides recorded on a reference the Style Set can no longer honour', () => {
		const composition = graphic([
			textItem({
				typography: {
					...inheritedTypography(),
					fontSize: 30,
				},
				styleRefs: {
					typography: {
						entryId: 'heading',
						overrides: { fontSize: 30 },
					},
				},
			}),
		]);

		const recaptured = recaptureGraphicStyleOverrides(
			editTextAlign(composition, 'center'),
			resolveGraphicStyleSet([]),
			LINKED,
			composition,
		);

		expect(headlineOf(recaptured).styleRefs?.typography)
			.toEqual({
				entryId: 'heading',
				overrides: { fontSize: 30 },
			});
	});

	it('keeps a Graphic Fill reference the Style Set can no longer honour', () => {
		const composition = boundFill();
		const edited = paintFill(composition, '#00ff88');

		// A Style Set that failed to load resolves nothing, and must not be the reason a
		// linked composition quietly goes local.
		const recaptured = recaptureGraphicStyleOverrides(edited, resolveGraphicStyleSet([]), LINKED, composition);

		expect(headlineOf(recaptured).styleRefs?.['surfaceStyle.fill']).toEqual({ entryId: 'accent-fill' });
	});

	// Behind the published Style Set, every derivable deviation is the Style Set's own change,
	// so nothing is derived until the two agree again.
	describe('while the composition is behind the published Style Set', () => {
		it('leaves a Graphic Fill reference the author never touched, so its update stays reviewable', () => {
			const stored = boundBoth();
			const behind = editFontSize(stored, 30);

			const recaptured = recaptureGraphicStyleOverrides(behind, resolveGraphicStyleSet(republished), AHEAD, stored);

			expect(headlineOf(recaptured).styleRefs?.['surfaceStyle.fill']).toEqual({ entryId: 'accent-fill' });
			// Severing the reference here would destroy the offer *and* the link, so no
			// later republish would ever reach this slot again either.
			expect(graphicStyleUpdateChanges(recaptured, resolveGraphicStyleSet(republished)).map(change => change.slot))
				.toContain('surfaceStyle.fill');
		});

		it('records no override on a typography entry the author never touched, so its update stays reviewable', () => {
			// The author's edit is to the fill; the typography they are inheriting is
			// untouched, and the only reason it differs from the entry is the republish.
			const stored = boundBoth();
			const behind = paintFill(stored, '#123456');

			const recaptured = recaptureGraphicStyleOverrides(behind, resolveGraphicStyleSet(republished), AHEAD, stored);

			expect(headlineOf(recaptured).styleRefs?.typography).toEqual({ entryId: 'heading' });
			expect(graphicStyleUpdateChanges(recaptured, resolveGraphicStyleSet(republished)).map(change => change.slot))
				.toContain('typography');
		});

		it('leaves the values the author has just written exactly where they are', () => {
			const stored = boundBoth();
			const behind = paintFill(editFontSize(stored, 30), '#123456');

			const recaptured = recaptureGraphicStyleOverrides(behind, resolveGraphicStyleSet(republished), AHEAD, stored);

			// Deferring the provenance is not refusing the edit: the composition stores its
			// values inline, and review is where the author is shown that their edit and the
			// Style Set's disagree.
			expect(headlineOf(recaptured).typography.fontSize).toBe(30);
			expect(headlineOf(recaptured).surfaceStyle?.fill).toEqual({ type: 'solid', color: '#123456' });
		});

		it('resumes recording deviations once the composition is reconciled to it', () => {
			const reconciled = applyGraphicStyleSet(
				boundBoth(),
				resolveGraphicStyleSet(republished),
				{ revision: AHEAD },
			);

			const recaptured = recaptureGraphicStyleOverrides(
				editFontSize(reconciled, 30),
				resolveGraphicStyleSet(republished),
				AHEAD,
				reconciled,
			);

			expect(headlineOf(recaptured).styleRefs?.typography)
				.toEqual({
					entryId: 'heading',
					overrides: { fontSize: 30 },
				});
		});
	});

	// Stranded on an old revision whose entries it already matches, slot by slot, so every
	// derivable deviation is the author's (#198).
	describe('while the composition is stranded on an old revision it is already in step with', () => {
		const PUBLISHED = 3;

		/** In step with `styleSet()`'s `heading`, and recorded three revisions behind it. */
		function stranded(): BroadcastGraphicConfig {
			return graphic([
				textItem({
					typography: inheritedTypography(),
					styleRefs: {
						typography: { entryId: 'heading' },
					},
				}),
			]);
		}

		it('records the author\'s edit as an explicit override', () => {
			const composition = stranded();

			const recaptured = recaptureGraphicStyleOverrides(
				editFontSize(composition, 30),
				resolveGraphicStyleSet(styleSet()),
				PUBLISHED,
				composition,
			);

			expect(headlineOf(recaptured).styleRefs?.typography)
				.toEqual({
					entryId: 'heading',
					overrides: { fontSize: 30 },
				});
		});

		it('keeps that edit through the next republish, applied with every row\'s default answer', () => {
			const composition = stranded();
			const edited = recaptureGraphicStyleOverrides(
				editFontSize(composition, 30),
				resolveGraphicStyleSet(styleSet()),
				PUBLISHED,
				composition,
			);

			// Revision 4 moves the colour `heading` resolves through, which is what finally
			// produces a review row for this slot.
			const next = resolveGraphicStyleSet(styleSet('#00ff88'));
			const changes = graphicStyleUpdateChanges(edited, next);
			expect(changes.map(change => change.slot)).toEqual(['typography']);
			// And the row is about the colour alone. The size is recorded as the author's,
			// so it is not something they are being asked to decide about.
			expect(graphicStyleChangedKeys(changes[0]!.current, changes[0]!.next)).toEqual(['color']);

			// No decisions at all, which is exactly what accepting every row's default does.
			const applied = applyGraphicStyleSet(edited, next, { revision: 4 });

			expect(headlineOf(applied).typography.fontSize).toBe(30);
			expect(headlineOf(applied).typography.color).toBe('#00ff88');
		});

		// In step is decided per slot, not per composition.
		it('still leaves a slot the Style Set has a pending change in', () => {
			// `accent-fill` moved off `brand` and onto `ink`, which reaches the fill and
			// nothing else: `heading` still resolves to exactly what the item holds.
			const fillMoved = [
				...styleSet(),
				entry('fill', 'accent-fill', { type: 'solid', colorEntryId: 'ink' }),
			];
			const composition = graphic([
				textItem({
					typography: inheritedTypography(),
					surfaceStyle: {
						fill: { type: 'solid', color: '#ff0044' },
						fillOpacity: 1,
					},
					styleRefs: {
						'typography': { entryId: 'heading' },
						'surfaceStyle.fill': { entryId: 'accent-fill' },
					},
				}),
			]);

			const recaptured = recaptureGraphicStyleOverrides(
				editFontSize(composition, 30),
				resolveGraphicStyleSet(fillMoved),
				PUBLISHED,
				composition,
			);

			expect(headlineOf(recaptured).styleRefs?.typography)
				.toEqual({
					entryId: 'heading',
					overrides: { fontSize: 30 },
				});
			// The fill's pending change is untouched and still reviewable — severing the
			// reference here would settle an update nobody reviewed.
			expect(headlineOf(recaptured).styleRefs?.['surfaceStyle.fill']).toEqual({ entryId: 'accent-fill' });
			expect(graphicStyleUpdateChanges(recaptured, resolveGraphicStyleSet(fillMoved)).map(change => change.slot))
				.toEqual(['surfaceStyle.fill']);
		});
	});

	// A pin the Style Set has caught up with is still the author's: recapture and
	// `applyGraphicStyleSet` read it the same way (#229).
	describe('when a republished entry lands on the value the author pinned', () => {
		const PINNED_SIZE = 30;
		/** The revision the coincident publish is at, which this composition lags. */
		const COINCIDENT = LINKED + 1;
		/** The Style Set after a publish that moved `heading`'s own size onto the pin. */
		const coincident = resolveGraphicStyleSet(styleSet('#ff0044', PINNED_SIZE));

		/** A composition carrying the author's recorded size pin, made the way one is. */
		function pinned(): BroadcastGraphicConfig {
			const composition = graphic([
				textItem({
					typography: inheritedTypography(),
					styleRefs: {
						typography: { entryId: 'heading' },
					},
				}),
			]);
			const recorded = recaptureGraphicStyleOverrides(
				editFontSize(composition, PINNED_SIZE),
				resolveGraphicStyleSet(styleSet()),
				LINKED,
				composition,
			);
			expect(headlineOf(recorded).styleRefs?.typography)
				.toEqual({
					entryId: 'heading',
					overrides: { fontSize: PINNED_SIZE },
				});
			return recorded;
		}

		it('keeps the pin through an edit to a key the entry does not even own', () => {
			const stored = pinned();

			const recaptured = recaptureGraphicStyleOverrides(
				editTextAlign(stored, 'center'),
				coincident,
				COINCIDENT,
				stored,
			);

			expect(headlineOf(recaptured).styleRefs?.typography)
				.toEqual({
					entryId: 'heading',
					overrides: { fontSize: PINNED_SIZE },
				});
		});

		it('keeps the pin once the composition is reconciled to the publish that landed on it', () => {
			const reconciled = applyGraphicStyleSet(pinned(), coincident, { revision: COINCIDENT });

			const recaptured = recaptureGraphicStyleOverrides(
				editTextAlign(reconciled, 'center'),
				coincident,
				COINCIDENT,
				reconciled,
			);

			expect(headlineOf(recaptured).styleRefs?.typography)
				.toEqual({
					entryId: 'heading',
					overrides: { fontSize: PINNED_SIZE },
				});
		});

		// Recapture walks every owner, so the edit that runs it can be anywhere.
		it('keeps the pin through an edit to another Graphic Item that references nothing', () => {
			const stored = pinned();
			const withSubtitle = {
				...stored,
				items: [
					...stored.items,
					textItem({ id: 'subtitle', label: 'Subtitle' }),
				],
			};
			const elsewhere = {
				...withSubtitle,
				items: withSubtitle.items.map(item => item.id === 'subtitle' && item.type === 'text'
					? {
							...item,
							typography: { ...item.typography, fontSize: 12 },
						}
					: item),
			};

			const recaptured = recaptureGraphicStyleOverrides(elsewhere, coincident, COINCIDENT, withSubtitle);

			expect(headlineOf(recaptured).styleRefs?.typography)
				.toEqual({
					entryId: 'heading',
					overrides: { fontSize: PINNED_SIZE },
				});
		});

		it('keeps the property when the Style Set moves it away again, applied with every row\'s default answer', () => {
			const stored = pinned();
			const edited = recaptureGraphicStyleOverrides(
				editTextAlign(stored, 'center'),
				coincident,
				COINCIDENT,
				stored,
			);

			const moved = resolveGraphicStyleSet(styleSet('#ff0044', 99));
			expect(graphicStyleUpdateChanges(edited, moved)).toEqual([]);

			// No decisions at all, which is exactly what accepting every row's default does.
			const applied = applyGraphicStyleSet(edited, moved, { revision: COINCIDENT + 1 });

			expect(headlineOf(applied).typography.fontSize).toBe(PINNED_SIZE);
		});

		// Review's "Keep mine" and an ordinary edit answer through one function.
		it('records what review\'s "Keep mine" records for the same slot', () => {
			const stored = pinned();

			const throughAnEdit = recaptureGraphicStyleOverrides(
				editTextAlign(stored, 'center'),
				coincident,
				COINCIDENT,
				stored,
			);
			const throughReview = applyGraphicStyleSet(stored, coincident, {
				decisions: { [graphicStyleChangeKey('headline', 'typography')]: 'keep-as-override' },
				revision: COINCIDENT,
			});

			expect(headlineOf(throughAnEdit).styleRefs?.typography?.overrides)
				.toEqual(headlineOf(throughReview).styleRefs?.typography?.overrides);
			expect(headlineOf(throughReview).styleRefs?.typography?.overrides)
				.toEqual({ fontSize: PINNED_SIZE });
		});

		it('releases the pin when the author moves the property and puts it back', () => {
			const stored = pinned();

			// Away from the pin. The recorded value is no longer what this owner holds, so
			// the claim is stale and the deviation the edit created replaces it.
			const moved = recaptureGraphicStyleOverrides(editFontSize(stored, 48), coincident, COINCIDENT, stored);
			expect(headlineOf(moved).styleRefs?.typography)
				.toEqual({
					entryId: 'heading',
					overrides: { fontSize: 48 },
				});

			// And back onto what the entry resolves to, which leaves nothing recorded.
			const released = recaptureGraphicStyleOverrides(
				editFontSize(moved, PINNED_SIZE),
				coincident,
				COINCIDENT,
				moved,
			);
			expect(headlineOf(released).styleRefs?.typography).toEqual({ entryId: 'heading' });
		});
	});

	// Typing the entry's own value records no pin, so the next republish takes the property.
	// Accepted, not fixed (#240, ADR-0006).
	describe('when the author types the value the entry already resolves to', () => {
		/** The size the entry itself holds, and the one the author types onto it. */
		const TYPED_SIZE = 30;
		/** The Style Set whose `heading` already resolves to what the author will type. */
		const atTypedSize = resolveGraphicStyleSet(styleSet('#ff0044', TYPED_SIZE));
		/** The same Style Set after a later publish that moves the size off it. */
		const moved = resolveGraphicStyleSet(styleSet('#ff0044', 99));

		/** A slot bound to `heading`, in step, holding the entry's own size. */
		function inStepAtTypedSize(): BroadcastGraphicConfig {
			return graphic([
				textItem({
					typography: inheritedTypography('#ff0044', TYPED_SIZE),
					styleRefs: {
						typography: { entryId: 'heading' },
					},
				}),
			]);
		}

		it('records nothing, and the next republish takes the property', () => {
			const stored = inStepAtTypedSize();
			const typed = editFontSize(stored, TYPED_SIZE);

			// The whole of the difficulty in one assertion: the author acted, and the
			// document cannot tell. No signal reaches recapture because none exists here.
			expect(typed).toEqual(stored);

			const recaptured = recaptureGraphicStyleOverrides(typed, atTypedSize, LINKED, stored);
			expect(headlineOf(recaptured).styleRefs?.typography).toEqual({ entryId: 'heading' });

			// So the property is inherited, and accepting every row's default moves it.
			const applied = applyGraphicStyleSet(recaptured, moved, { revision: LINKED + 1 });
			expect(headlineOf(applied).typography.fontSize).toBe(99);
		});

		// The mitigation for #240: an unpinned property gets a review row; a pinned one gets none.
		it('offers the review row that is the whole mitigation, and offers none once pinned', () => {
			const stored = inStepAtTypedSize();
			const unpinned = recaptureGraphicStyleOverrides(editFontSize(stored, TYPED_SIZE), atTypedSize, LINKED, stored);

			const offered = graphicStyleUpdateChanges(unpinned, moved);
			expect(offered).toHaveLength(1);
			expect(offered[0]).toMatchObject({ slot: 'typography', entryId: 'heading' });
			// The row names the author's own value against the one about to replace it,
			// which is what makes the default answer an informed one (#162).
			expect(graphicStyleChangedKeys(offered[0]!.current, offered[0]!.next)).toEqual(['fontSize']);
			expect((offered[0]!.current as { fontSize: number }).fontSize).toBe(TYPED_SIZE);
			expect((offered[0]!.next as { fontSize: number }).fontSize).toBe(99);

			// And answering it recovers exactly what the typing failed to record.
			const kept = applyGraphicStyleSet(unpinned, moved, {
				decisions: { [graphicStyleChangeKey('headline', 'typography')]: 'keep-as-override' },
				revision: LINKED + 1,
			});
			expect(headlineOf(kept).typography.fontSize).toBe(TYPED_SIZE);
			expect(headlineOf(kept).styleRefs?.typography).toEqual({
				entryId: 'heading',
				overrides: { fontSize: TYPED_SIZE },
			});

			// The other side of the asymmetry: now that it is pinned, the Style Set moving
			// again says nothing at all. A pin bought by a keystroke would be this silent
			// from the start.
			expect(graphicStyleUpdateChanges(kept, resolveGraphicStyleSet(styleSet('#ff0044', 12)))).toEqual([]);
		});
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
			children: [
				textItem({
					id: 'child',
					styleRefs: {
						typography: { entryId: 'heading' },
					},
				}),
			],
			styleRefs: {
				geometry: { entryId: 'cut-corner' },
			},
		};

		const ids = graphicStyleSetEntryIdsInDocument(graphic(
			[group],
			{
				styleRefs: {
					'animation.enter': { entryId: 'rise' },
				},
			},
		));

		expect([...ids].sort()).toEqual(['cut-corner', 'heading', 'rise']);
	});
});
