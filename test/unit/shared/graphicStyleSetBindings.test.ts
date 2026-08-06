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
import { GRAPHIC_SURFACE_STYLE_SLOT_KINDS, squareShapeGeometry } from '~~/shared/modules/graphics';
import { GRAPHIC_STYLE_SLOT_VALUES } from '~~/shared/types/graphicStyleSet';

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

/**
 * A typography that already matches what the `heading` entry resolves to.
 *
 * `TYPOGRAPHY` above deliberately disagrees with the preset in most keys, which is
 * what most of these tests want. A test about *which* keys an author deviates in
 * needs the opposite starting point: an item in step with its entry, so a single
 * edited value is the only deviation there is.
 */
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
	/**
	 * The owned-key lists are strings, and the property groups they name are types.
	 * Nothing makes them agree, and the failure if they stop agreeing is silent: a
	 * field added to `GraphicTypography` or `ShapeGeometry` would keep being written
	 * by the property control and stop being capturable as an override, so an author's
	 * deviation in it would be reverted by the next applied update with nothing
	 * rejected. So each list is pinned against a maximal value of its property group,
	 * built from the vocabulary rather than restated.
	 *
	 * "Maximal" is what `Required<…>` buys: a field added to any of these groups —
	 * optional or not — fails to typecheck here until it is written down, and writing
	 * it down is what makes this assertion notice it. A hand-restated list of key
	 * literals would simply stay green, which is the drift this test exists to catch.
	 */
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
			reveal: { edge: 'south' },
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

	/**
	 * The Graphic Surface Style slots are shared with the authoring module that edits
	 * those same surfaces, and each side would happily hold its own opinion about
	 * which Graphic Item kinds own them. If they drifted, a picker would be offered
	 * for a surface the item does not have and would then write nothing — visible
	 * only as a control that does not work. So the inheriting side is asserted to
	 * agree with the editing side, which is the one that owns the fact.
	 */
	it('agrees with the authoring module about which kinds own each Graphic Surface Style', () => {
		const kinds = [
			'text',
			'shape',
			'media',
			'group',
			'clock',
			'player-life',
			'game-wins',
		] as const;

		for (const slot of ['surfaceStyle', 'boxSurfaceStyle', 'wonBoxSurfaceStyle'] as const) {
			for (const kind of kinds) {
				expect(graphicStyleOwnerSupportsSlot({ type: kind } as GraphicItemConfig, slot))
					.toBe(GRAPHIC_SURFACE_STYLE_SLOT_KINDS[slot].includes(kind));
			}
		}
	});

	it('gives every slot in the vocabulary a list', () => {
		expect(Object.keys(GRAPHIC_STYLE_SLOT_OWNED_KEYS).sort())
			.toEqual([...GRAPHIC_STYLE_SLOT_VALUES].sort());
	});
});

describe('applyGraphicStyleSet', () => {
	it('writes a typography preset\'s resolved properties into the item and leaves the item-specific ones alone', () => {
		const composition = graphic([textItem({ styleRefs: { typography: { entryId: 'heading' } } })]);

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

	it('inherits each of a Game Wins item\'s three surfaces independently', () => {
		const surface = { fill: { type: 'solid' as const, color: '#000000' }, fillOpacity: 1 };
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
		expect(item.boxGeometry).toMatchObject({ topRight: { treatment: 'cut', size: 24 } });
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

	/**
	 * What "Keep mine" pins (#162).
	 *
	 * The answer is about one property group, but the author's work inside it is
	 * usually one key. Recording the whole group would freeze every key the Style Set
	 * and the author already agree on against every future republish — which is a
	 * bigger commitment than the author made, and one this surface never asked them
	 * about.
	 */
	it('pins only the keys the author deviates in, not the whole property group', () => {
		// Behind the published revision, an author's own edit records no override — so
		// what they wrote lives inline and nothing but this decision preserves it.
		const composition = graphic([textItem({
			typography: { ...inheritedTypography(), fontSize: 30 },
			styleRefs: { typography: { entryId: 'heading' } },
		})]);

		const applied = applyGraphicStyleSet(
			composition,
			resolveGraphicStyleSet(styleSet('#ff0044', 99)),
			{ decisions: { [graphicStyleChangeKey('headline', 'typography')]: 'keep-as-override' } },
		);

		// The one key the author wrote, and only it. Everything else keeps inheriting, so
		// the next republish still reaches this slot.
		expect(headlineOf(applied).styleRefs?.typography?.overrides).toEqual({ fontSize: 30 });
	});

	it('keeps an override the author already had when a different key moves', () => {
		const composition = graphic([textItem({
			typography: { ...inheritedTypography(), fontSize: 30 },
			styleRefs: { typography: { entryId: 'heading', overrides: { fontSize: 30 } } },
		})]);

		// The palette moves the typography preset's colour; the size the author already
		// pinned does not move at all.
		const applied = applyGraphicStyleSet(
			composition,
			resolveGraphicStyleSet(styleSet('#00ff88')),
			{ decisions: { [graphicStyleChangeKey('headline', 'typography')]: 'keep-as-override' } },
		);

		// Both are the author's: one they had pinned, one they are pinning now. Narrowing
		// to "the keys that moved" alone would have dropped the first.
		expect(headlineOf(applied).styleRefs?.typography?.overrides)
			.toEqual({ fontSize: 30, color: '#ff0044' });
	});

	/** A slot the author has kept offers nothing further, which is what settles it. */
	it('leaves no update outstanding on a slot the author kept', () => {
		const republished = styleSet('#ff0044', 99);
		const composition = graphic([textItem({
			typography: { ...inheritedTypography(), fontSize: 30 },
			styleRefs: { typography: { entryId: 'heading' } },
		})]);

		const applied = applyGraphicStyleSet(
			composition,
			resolveGraphicStyleSet(republished),
			{ decisions: { [graphicStyleChangeKey('headline', 'typography')]: 'keep-as-override' } },
		);

		expect(graphicStyleUpdateChanges(applied, resolveGraphicStyleSet(republished))).toEqual([]);
	});

	/**
	 * An override the author had already pinned survives even when the republished
	 * preset happens to land on the same value.
	 *
	 * "Where this owner deviates from the entry" is not the whole answer to "what is
	 * mine". A pin whose value the new preset coincidentally agrees with is no longer a
	 * deviation, but it is still the author's explicit statement that this property is
	 * theirs — and dropping it means the next republish that moves the preset away takes
	 * the property with it. Story 20's "with my local property overrides preserved"
	 * is exactly what that would break.
	 */
	it('keeps a pin the republished preset happens to agree with', () => {
		const composition = graphic([textItem({
			typography: { ...inheritedTypography(), fontSize: 30 },
			styleRefs: { typography: { entryId: 'heading', overrides: { fontSize: 30 } } },
		})]);

		// The republished preset moves the colour and lands on the author's own size.
		const applied = applyGraphicStyleSet(
			composition,
			resolveGraphicStyleSet(styleSet('#00ff88', 30)),
			{ decisions: { [graphicStyleChangeKey('headline', 'typography')]: 'keep-as-override' } },
		);

		expect(headlineOf(applied).styleRefs?.typography?.overrides)
			.toEqual({ fontSize: 30, color: '#ff0044' });
	});

	/**
	 * A stored value that agrees with the preset while its own recorded override does
	 * not pins nothing at all.
	 *
	 * The override is stale — it describes a value this owner is not holding — so there
	 * is nothing of the author's in this slot to keep. Recording the whole property
	 * group would freeze eight keys on the strength of provenance the document itself
	 * contradicts. An empty override settles the row just as well, because what the
	 * entry resolves to is already what is stored.
	 */
	it('pins nothing when a slot holds the preset and only a stale override disagrees', () => {
		const composition = graphic([textItem({
			typography: inheritedTypography(),
			styleRefs: { typography: { entryId: 'heading', overrides: { fontSize: 999 } } },
		})]);

		const applied = applyGraphicStyleSet(
			composition,
			resolveGraphicStyleSet(styleSet()),
			{ decisions: { [graphicStyleChangeKey('headline', 'typography')]: 'keep-as-override' } },
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
		const entries = [...styleSet(), entry('fill', 'accent-fill', { type: 'solid', colorEntryId: 'brand' })];
		const composition = applyGraphicStyleSet(
			graphic([textItem({
				surfaceStyle: { fill: { type: 'solid', color: '#000000' }, fillOpacity: 1 },
				styleRefs: { 'surfaceStyle.fill': { entryId: 'accent-fill' } },
			})]),
			resolveGraphicStyleSet(entries),
		);

		const applied = applyGraphicStyleSet(
			composition,
			resolveGraphicStyleSet([...styleSet('#00ff88'), entry('fill', 'accent-fill', { type: 'solid', colorEntryId: 'brand' })]),
			{ decisions: { [graphicStyleChangeKey('headline', 'surfaceStyle.fill')]: 'keep-as-override' } },
		);

		// A Graphic Fill has no partial to record a deviation in, so keeping it means the
		// property goes local. Recording an empty override instead would leave the
		// reference in place and offer the same change again on every later review.
		expect(headlineOf(applied).surfaceStyle?.fill).toEqual({ type: 'solid', color: '#ff0044' });
		expect(headlineOf(applied).styleRefs?.['surfaceStyle.fill']).toBeUndefined();
		expect(graphicStyleUpdateChanges(
			applied,
			resolveGraphicStyleSet([...styleSet('#00ff88'), entry('fill', 'accent-fill', { type: 'solid', colorEntryId: 'brand' })]),
		)).toEqual([]);
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

describe('recaptureGraphicStyleOverrides', () => {
	const withAccentFill = [...styleSet(), entry('fill', 'accent-fill', { type: 'solid', colorEntryId: 'brand' })];
	/**
	 * The revision every composition here is linked at, and the one the editor is
	 * holding while the two agree.
	 */
	const LINKED = 1;
	/**
	 * The same Style Set after a publish this composition has *not* been reconciled to.
	 * `brand` moved, so both the typography preset's colour and the Graphic Fill do.
	 */
	const republished = [...styleSet('#00ff88'), entry('fill', 'accent-fill', { type: 'solid', colorEntryId: 'brand' })];
	const AHEAD = LINKED + 1;

	/** One composition whose Graphic Fill is inherited from `accent-fill`. */
	function boundFill(): BroadcastGraphicConfig {
		return applyGraphicStyleSet(
			graphic([textItem({
				surfaceStyle: { fill: { type: 'solid', color: '#000000' }, fillOpacity: 1 },
				styleRefs: { 'surfaceStyle.fill': { entryId: 'accent-fill' } },
			})]),
			resolveGraphicStyleSet(withAccentFill),
		);
	}

	/** One composition inheriting both a typography preset and a Graphic Fill. */
	function boundBoth(): BroadcastGraphicConfig {
		return applyGraphicStyleSet(
			graphic([textItem({
				surfaceStyle: { fill: { type: 'solid', color: '#000000' }, fillOpacity: 1 },
				styleRefs: {
					'typography': { entryId: 'heading' },
					'surfaceStyle.fill': { entryId: 'accent-fill' },
				},
			})]),
			resolveGraphicStyleSet(withAccentFill),
		);
	}

	/** A property control writing a size, which is what makes a recapture run. */
	function editFontSize(composition: BroadcastGraphicConfig, fontSize: number): BroadcastGraphicConfig {
		return {
			...composition,
			items: composition.items.map(item => item.type === 'text'
				? { ...item, typography: { ...item.typography, fontSize } }
				: item),
		};
	}

	/**
	 * An edit to the one typography key the slot does not own.
	 *
	 * It still runs a recapture — every property edit does — while changing nothing the
	 * entry has an opinion about, which is what makes it the cleanest form of "the author
	 * touched this document" there is.
	 */
	function editTextAlign(composition: BroadcastGraphicConfig, textAlign: 'left' | 'center'): BroadcastGraphicConfig {
		return {
			...composition,
			items: composition.items.map(item => item.id === 'headline' && item.type === 'text'
				? { ...item, typography: { ...item.typography, textAlign } }
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
					surfaceStyle: { ...item.surfaceStyle!, fill: { type: 'solid' as const, color } },
				};
			}),
		};
	}

	it('turns an edit to an inherited typography property into an explicit override', () => {
		const resolution = resolveGraphicStyleSet(styleSet());
		const composition = applyGraphicStyleSet(
			graphic([textItem({ styleRefs: { typography: { entryId: 'heading' } } })]),
			resolution,
		);

		const recaptured = recaptureGraphicStyleOverrides(
			editFontSize(composition, 30),
			resolution,
			LINKED,
			composition,
		);

		expect(headlineOf(recaptured).styleRefs?.typography)
			.toEqual({ entryId: 'heading', overrides: { fontSize: 30 } });
	});

	it('lets go of a Graphic Fill reference the author has painted over', () => {
		const resolution = resolveGraphicStyleSet(withAccentFill);
		const composition = boundFill();
		const edited = paintFill(composition, '#00ff88');

		const recaptured = recaptureGraphicStyleOverrides(edited, resolution, LINKED, composition);

		// A Graphic Fill is a discriminated union with no partial to record a deviation
		// in, so deviating from the preset is unbinding it — the same answer "Keep mine"
		// gives during review. The value is already inline, so only the provenance moves.
		expect(headlineOf(recaptured).surfaceStyle?.fill).toEqual({ type: 'solid', color: '#00ff88' });
		expect(headlineOf(recaptured).styleRefs?.['surfaceStyle.fill']).toBeUndefined();
		// And the badge stops reporting an update the author has already acted on. A
		// reference kept here would offer this same change on every later review, with no
		// answer that ever settles it.
		expect(graphicStyleUpdateChanges(recaptured, resolution)).toEqual([]);
	});

	it('keeps a Graphic Fill reference the author has left where the preset put it', () => {
		const resolution = resolveGraphicStyleSet(withAccentFill);
		const composition = boundFill();

		const recaptured = recaptureGraphicStyleOverrides(composition, resolution, LINKED, composition);

		expect(headlineOf(recaptured).styleRefs?.['surfaceStyle.fill']).toEqual({ entryId: 'accent-fill' });
	});

	it('keeps a Graphic Fill reference the author has edited back to the preset\'s own value', () => {
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

	/**
	 * What became of an over-broad pin written before "Keep mine" was narrowed (#167).
	 *
	 * A composition written by the pre-#162 behaviour carries the whole property group as
	 * its override, and `applyGraphicStyleSet` preserves it forever: every one of those
	 * keys genuinely is a recorded override the stored value honours, so a later "Keep
	 * mine" narrows nothing. An ordinary edit used to be what did narrow it — recapture
	 * re-derived each slot's overrides from what the composition deviates in and discarded
	 * the recorded set — and that is the discard #229 removed, because it could not tell
	 * this pin from a deliberate one the Style Set had caught up with. They are the same
	 * keys in storage, which is the reading ADR-0006 already rejects for a migration.
	 *
	 * So an over-broad pin survives an edit at full width. The key the author moves is not
	 * an exception: the recorded claim on it goes stale and the deviation the edit created
	 * replaces it, which is a re-pin at the new value rather than a release. The population
	 * that could be carrying one is empty by construction (#60), and losing a real override
	 * is the worse failure of the two.
	 */
	it('keeps all eight keys of an over-broad pin, re-pinning the one the author moves', () => {
		const resolution = resolveGraphicStyleSet(styleSet());
		const inStep = inheritedTypography();
		// What the pre-#162 "Keep mine" recorded: the whole property group, every key of
		// it agreeing with the preset the composition is in step with.
		const wholeGroup = Object.fromEntries(
			GRAPHIC_STYLE_SLOT_OWNED_KEYS.typography.map(key => [key, inStep[key as keyof typeof inStep]]),
		);
		const overPinned = graphic([textItem({
			typography: inStep,
			styleRefs: { typography: { entryId: 'heading', overrides: wholeGroup } },
		})]);

		const recaptured = recaptureGraphicStyleOverrides(editFontSize(overPinned, 30), resolution, LINKED, overPinned);

		expect(headlineOf(recaptured).styleRefs?.typography)
			.toEqual({ entryId: 'heading', overrides: { ...wholeGroup, fontSize: 30 } });
		// Still eight keys wide, so every one of them goes on inheriting nothing. That is
		// the cost ADR-0006's Consequences names rather than the narrowing it used to.
		expect(Object.keys(headlineOf(recaptured).styleRefs!.typography!.overrides!)).toHaveLength(8);
		expect(graphicStyleUpdateChanges(recaptured, resolveGraphicStyleSet(styleSet('#00ff88')))).toEqual([]);
	});

	/**
	 * The one thing that takes a key off a pin, and the reason it is not much of an escape.
	 *
	 * A recorded override survives while the stored value honours it, so the author releases
	 * one by landing the property exactly on what the entry resolves to — not by moving it,
	 * which re-pins it at wherever they moved it to. And a fully pinned slot produces no
	 * review row, so the value they would have to land on is never shown to them. What
	 * clears a pin in practice is unbinding the slot and binding it again, below.
	 */
	it('releases one key of an over-broad pin when the author lands it back on the entry\'s value', () => {
		const resolution = resolveGraphicStyleSet(styleSet());
		const inStep = inheritedTypography();
		const wholeGroup = Object.fromEntries(
			GRAPHIC_STYLE_SLOT_OWNED_KEYS.typography.map(key => [key, inStep[key as keyof typeof inStep]]),
		);
		const overPinned = graphic([textItem({
			typography: inStep,
			styleRefs: { typography: { entryId: 'heading', overrides: wholeGroup } },
		})]);

		const moved = recaptureGraphicStyleOverrides(editFontSize(overPinned, 30), resolution, LINKED, overPinned);
		// Back onto the entry's own size, which is what `styleSet()` resolves `heading` to.
		const landed = recaptureGraphicStyleOverrides(editFontSize(moved, 64), resolution, LINKED, moved);

		const { fontSize: _released, ...stillPinned } = wholeGroup;
		expect(headlineOf(landed).styleRefs?.typography).toEqual({ entryId: 'heading', overrides: stillPinned });
		// And no review row ever offered that 64, because a fully pinned slot resolves to
		// what the owner already holds — so nothing on screen names the value to land on.
		expect(graphicStyleUpdateChanges(overPinned, resolveGraphicStyleSet(styleSet('#ff0044', 99)))).toEqual([]);
	});

	/**
	 * The reset ADR-0006 names, and the only one that clears a whole pin.
	 *
	 * Unbinding keeps the values and drops the provenance; binding again starts with no
	 * overrides at all, because the author has just said "this comes from there". Both are
	 * offered next to the slot's picker, so this is a thing an author can actually do.
	 */
	it('clears an over-broad pin when the slot is unbound and bound again', () => {
		const inStep = inheritedTypography();
		const overPinned = graphic([textItem({
			typography: inStep,
			styleRefs: {
				typography: {
					entryId: 'heading',
					overrides: Object.fromEntries(
						GRAPHIC_STYLE_SLOT_OWNED_KEYS.typography.map(key => [key, inStep[key as keyof typeof inStep]]),
					),
				},
			},
		})]);
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

	/**
	 * Deriving nothing is not the same as deriving that nothing is the author's.
	 *
	 * A Style Set that failed to load resolves no entry, so there is no preset in front of
	 * this slot to disagree with and no deviation to read off it. What is recorded is then
	 * the only evidence there is, and it survives — the same reason a reference the
	 * resolution cannot honour is left in place rather than dropped.
	 */
	it('keeps the overrides recorded on a reference the Style Set can no longer honour', () => {
		const composition = graphic([textItem({
			typography: { ...inheritedTypography(), fontSize: 30 },
			styleRefs: { typography: { entryId: 'heading', overrides: { fontSize: 30 } } },
		})]);

		const recaptured = recaptureGraphicStyleOverrides(
			editTextAlign(composition, 'center'),
			resolveGraphicStyleSet([]),
			LINKED,
			composition,
		);

		expect(headlineOf(recaptured).styleRefs?.typography)
			.toEqual({ entryId: 'heading', overrides: { fontSize: 30 } });
	});

	it('keeps a Graphic Fill reference the Style Set can no longer honour', () => {
		const composition = boundFill();
		const edited = paintFill(composition, '#00ff88');

		// A Style Set that failed to load resolves nothing, and must not be the reason a
		// linked composition quietly goes local.
		const recaptured = recaptureGraphicStyleOverrides(edited, resolveGraphicStyleSet([]), LINKED, composition);

		expect(headlineOf(recaptured).styleRefs?.['surfaceStyle.fill']).toEqual({ entryId: 'accent-fill' });
	});

	/**
	 * The editor holds the *published* Style Set, so after a republish it is holding
	 * entries this composition has not been reconciled to. Every deviation it could
	 * derive from them is then the Style Set's own change wearing the author's name,
	 * and recording one — as an override, or by letting go of a reference — resolves a
	 * pending update without anybody reviewing it. That is the one thing story 20
	 * forbids, so nothing is derived at all until the two agree again.
	 */
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

		it('records no override on a typography preset the author never touched, so its update stays reviewable', () => {
			// The author's edit is to the fill; the typography they are inheriting is
			// untouched, and the only reason it differs from the preset is the republish.
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
				.toEqual({ entryId: 'heading', overrides: { fontSize: 30 } });
		});
	});

	/**
	 * A composition whose recorded revision lags a Style Set its values already agree
	 * with — what a publish that changed only entries this composition never references
	 * leaves behind, since such a publish offers nothing to review and so never moves
	 * the number (#198).
	 *
	 * The revision comparison above is a proxy for the question that actually matters:
	 * is there a pending Style Set change here that recording a deviation would absorb?
	 * Here there is none — slot by slot, what the composition holds is what the
	 * published entries resolve to — so every deviation derivable from them is the
	 * author's, and the guard has nothing to protect.
	 */
	describe('while the composition is stranded on an old revision it is already in step with', () => {
		const PUBLISHED = 3;

		/** In step with `styleSet()`'s `heading`, and recorded three revisions behind it. */
		function stranded(): BroadcastGraphicConfig {
			return graphic([textItem({
				typography: inheritedTypography(),
				styleRefs: { typography: { entryId: 'heading' } },
			})]);
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
				.toEqual({ entryId: 'heading', overrides: { fontSize: 30 } });
		});

		/**
		 * The whole defect, end to end: the edit is made while stranded, and the review
		 * that finally reaches this slot is taken with the answer the panel defaults to.
		 */
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

		/**
		 * Being in step is decided per slot, not per composition. A stranded composition
		 * can hold both a slot with nothing pending and a slot the Style Set is waiting to
		 * change, and each gets the answer its own evidence supports.
		 */
		it('still leaves a slot the Style Set has a pending change in', () => {
			// `accent-fill` moved off `brand` and onto `ink`, which reaches the fill and
			// nothing else: `heading` still resolves to exactly what the item holds.
			const fillMoved = [...styleSet(), entry('fill', 'accent-fill', { type: 'solid', colorEntryId: 'ink' })];
			const composition = graphic([textItem({
				typography: inheritedTypography(),
				surfaceStyle: { fill: { type: 'solid', color: '#ff0044' }, fillOpacity: 1 },
				styleRefs: {
					'typography': { entryId: 'heading' },
					'surfaceStyle.fill': { entryId: 'accent-fill' },
				},
			})]);

			const recaptured = recaptureGraphicStyleOverrides(
				editFontSize(composition, 30),
				resolveGraphicStyleSet(fillMoved),
				PUBLISHED,
				composition,
			);

			expect(headlineOf(recaptured).styleRefs?.typography)
				.toEqual({ entryId: 'heading', overrides: { fontSize: 30 } });
			// The fill's pending change is untouched and still reviewable — severing the
			// reference here would settle an update nobody reviewed.
			expect(headlineOf(recaptured).styleRefs?.['surfaceStyle.fill']).toEqual({ entryId: 'accent-fill' });
			expect(graphicStyleUpdateChanges(recaptured, resolveGraphicStyleSet(fillMoved)).map(change => change.slot))
				.toEqual(['surfaceStyle.fill']);
		});
	});

	/**
	 * A pin the Style Set has caught up with is still the author's (#229).
	 *
	 * An override is a claim about a property — "this one is mine" — and a republished
	 * preset landing on the value it names does not retract the claim. Recapture used to
	 * derive the whole record from where the composition deviates, so a pin the preset
	 * agreed with was not a deviation and stopped being recorded; the author's next edit
	 * anywhere in the document dropped it, and the republish after that took the property
	 * back. `applyGraphicStyleSet` had always read the signal the other way, and these
	 * pin the two paths reading it the same way.
	 */
	describe('when a republished preset lands on the value the author pinned', () => {
		const PINNED_SIZE = 30;
		/** The revision the coincident publish is at, which this composition lags. */
		const COINCIDENT = LINKED + 1;
		/** The Style Set after a publish that moved `heading`'s own size onto the pin. */
		const coincident = resolveGraphicStyleSet(styleSet('#ff0044', PINNED_SIZE));

		/** A composition carrying the author's recorded size pin, made the way one is. */
		function pinned(): BroadcastGraphicConfig {
			const composition = graphic([textItem({
				typography: inheritedTypography(),
				styleRefs: { typography: { entryId: 'heading' } },
			})]);
			const recorded = recaptureGraphicStyleOverrides(
				editFontSize(composition, PINNED_SIZE),
				resolveGraphicStyleSet(styleSet()),
				LINKED,
				composition,
			);
			expect(headlineOf(recorded).styleRefs?.typography)
				.toEqual({ entryId: 'heading', overrides: { fontSize: PINNED_SIZE } });
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
				.toEqual({ entryId: 'heading', overrides: { fontSize: PINNED_SIZE } });
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
				.toEqual({ entryId: 'heading', overrides: { fontSize: PINNED_SIZE } });
		});

		/**
		 * Recapture walks every owner in the composition, so the edit that runs it need not
		 * be to this slot, this item, or any item holding a reference at all.
		 */
		it('keeps the pin through an edit to another Graphic Item that references nothing', () => {
			const stored = pinned();
			const withSubtitle = {
				...stored,
				items: [...stored.items, textItem({ id: 'subtitle', label: 'Subtitle' })],
			};
			const elsewhere = {
				...withSubtitle,
				items: withSubtitle.items.map(item => item.id === 'subtitle' && item.type === 'text'
					? { ...item, typography: { ...item.typography, fontSize: 12 } }
					: item),
			};

			const recaptured = recaptureGraphicStyleOverrides(elsewhere, coincident, COINCIDENT, withSubtitle);

			expect(headlineOf(recaptured).styleRefs?.typography)
				.toEqual({ entryId: 'heading', overrides: { fontSize: PINNED_SIZE } });
		});

		/**
		 * The whole defect, end to end: the pin survives the edit, so the republish that
		 * moves the preset off it again does not take the property — and does not even ask,
		 * because a pinned property is not one the author is deciding about.
		 */
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

		/**
		 * The two paths, asked about the same slot in the same state.
		 *
		 * This is the disagreement the ticket named as the thing to resolve: review's "Keep
		 * mine" preserved a recorded pin the stored value still honours, and an ordinary
		 * edit discarded it. Both now answer through one function, so a change to either
		 * reading has to be made deliberately for both.
		 */
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

		/**
		 * And the pin is not permanent, which is what keeps this from being the over-broad
		 * pin problem in a new place: the author releases it by moving the property, the
		 * only thing that ever released one.
		 */
		it('releases the pin when the author moves the property and puts it back', () => {
			const stored = pinned();

			// Away from the pin. The recorded value is no longer what this owner holds, so
			// the claim is stale and the deviation the edit created replaces it.
			const moved = recaptureGraphicStyleOverrides(editFontSize(stored, 48), coincident, COINCIDENT, stored);
			expect(headlineOf(moved).styleRefs?.typography)
				.toEqual({ entryId: 'heading', overrides: { fontSize: 48 } });

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

	/**
	 * A value the author types *onto* the preset's own value records nothing, and the
	 * next republish takes the property. Accepted, not fixed (#240).
	 *
	 * #229 made a *recorded* pin survive the Style Set arriving at its value. This is the
	 * other half, and it is not the same case: there was never a pin to preserve. Capture
	 * is a diff against the entry, and a value that agrees with the entry is not a diff,
	 * so an author who types the size the preset already resolves to leaves the document
	 * byte-identical and the record empty.
	 *
	 * The intent signal a fix needs exists — the inspector's controls write
	 * `updateTypography({ fontSize })`, which names the key — but recording a pin from it
	 * costs more than it buys, and the direction it fails in is the wrong one. The
	 * reasoning is in ADR-0006 under "Record a pin whenever the author edits an owned
	 * key". These pin the two halves of it that are executable: the behaviour itself, and
	 * the review row that is the whole of what makes it survivable.
	 */
	describe('when the author types the value the preset already resolves to', () => {
		/** The size the entry itself holds, and the one the author types onto it. */
		const TYPED_SIZE = 30;
		/** The Style Set whose `heading` already resolves to what the author will type. */
		const atTypedSize = resolveGraphicStyleSet(styleSet('#ff0044', TYPED_SIZE));
		/** The same Style Set after a later publish that moves the size off it. */
		const moved = resolveGraphicStyleSet(styleSet('#ff0044', 99));

		/** A slot bound to `heading`, in step, holding the entry's own size. */
		function inStepAtTypedSize(): BroadcastGraphicConfig {
			return graphic([textItem({
				typography: inheritedTypography('#ff0044', TYPED_SIZE),
				styleRefs: { typography: { entryId: 'heading' } },
			})]);
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

		/**
		 * Why the paragraph above is a cost worth accepting rather than a silent loss.
		 *
		 * An unpinned property is one review states, value by value, before it moves it
		 * (#162) — so the author who meant that 30 is shown `30 → 99` and can answer "Keep
		 * mine". A *pinned* property is the silent one: it resolves to what the owner
		 * already holds, so it produces no row and no screen ever names it again.
		 *
		 * That asymmetry is the reason recording a pin from a keystroke would fail in the
		 * worse direction, and it is the thing a fix must not quietly reverse. If this
		 * stops holding, the acceptance recorded in ADR-0006 no longer stands up.
		 */
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
