import type { GraphicGroupChildConfig, GraphicItemConfig, GraphicSurfaceStyle } from '~~/shared/types/graphics';
import type { FeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import { describe, expect, it } from 'vitest';
import { FEATURE_MATCH_OVERLAY_PRESETS } from '~~/shared/featureMatchOverlayPresets';
import { FEATURE_MATCH_TOKEN_KEYS } from '~~/shared/featureMatchTokenCatalogue';
import {
	BROADCAST_GRAPHICS_HOST_CONTRACT,
	FEATURE_MATCH_OVERLAY_HOST_CONTRACT,
	graphicItemDefinitionsForHost,
	graphicsHostTokenCatalogue,
	isRectangularShapeGeometry,
	parseGraphicTextTemplate,
} from '~~/shared/modules/graphics';
import { MAX_GRAPHIC_FILL_STOPS, MIN_GRAPHIC_FILL_STOPS } from '~~/shared/types/graphics';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';

/**
 * The Feature Match Overlay capability-parity checklist, verified row by row.
 *
 * `docs/feature-match-overlay-capability-parity.md` is the settled mapping from
 * each legacy Feature Match Overlay construct to its Shared Graphics Foundation
 * equivalent. Spec #60 uses it *instead of* a data migration: the database is
 * wiped before ship, so what proves the rewrite kept its capability is that the
 * built-in Feature Match Overlay Presets are recreated on the shared schema and
 * every row of the mapping lands somewhere in them.
 *
 * Each test below names one row. A row that stops being true here is a
 * capability the shared compositor can no longer express.
 */

function allItems(items: readonly GraphicItemConfig[]): Array<GraphicItemConfig | GraphicGroupChildConfig> {
	return items.flatMap(item => item.type === 'group' ? [item, ...item.children] : [item]);
}

function presetItems(config: Omit<FeatureMatchOverlayModeConfig, 'featureMatchId'>) {
	return allItems(config.layout.composition.items);
}

function everyPresetItem() {
	return FEATURE_MATCH_OVERLAY_PRESETS.flatMap(preset => presetItems(preset.config));
}

function surfaceStyles(): GraphicSurfaceStyle[] {
	return everyPresetItem().flatMap((item) => {
		const styles: GraphicSurfaceStyle[] = [];
		if ('surfaceStyle' in item && item.surfaceStyle)
			styles.push(item.surfaceStyle);
		if (item.type === 'group' && item.defaultChildSurfaceStyle)
			styles.push(item.defaultChildSurfaceStyle);
		if (item.type === 'game-wins')
			styles.push(item.boxSurfaceStyle, item.wonBoxSurfaceStyle);
		return styles;
	});
}

describe('feature Match Overlay capability parity', () => {
	it('recreates all three built-in presets as Feature Match Layouts on the shared schema', () => {
		expect(FEATURE_MATCH_OVERLAY_PRESETS.map(preset => preset.id))
			.toEqual(['full-table', 'left-stacked-player-cams', 'neon-feature-match']);

		for (const preset of FEATURE_MATCH_OVERLAY_PRESETS) {
			expect(preset.config.layout.composition.items.length, preset.id).toBeGreaterThan(0);
			expect(preset.config.layout.sources.length, preset.id).toBeGreaterThan(0);
		}
	});

	it('has no legacy widget, widget-group, or numeric z-index left to carry', () => {
		const layout = DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG.layout as unknown as Record<string, unknown>;

		expect(layout.items).toBeUndefined();
		expect(layout.widgets).toBeUndefined();
		for (const item of everyPresetItem()) {
			expect(item).not.toHaveProperty('zIndex');
			expect(item).not.toHaveProperty('widget');
			expect(['text', 'shape', 'media', 'group', 'clock', 'player-life', 'game-wins']).toContain(item.type);
		}
	});

	it('row: text widget with a {token} template becomes a Text Graphic Item on the host token catalogue', () => {
		const texts = everyPresetItem().filter(item => item.type === 'text');
		const placeholders = texts.flatMap(item =>
			parseGraphicTextTemplate(item.text)
				.map(segment => segment.inputKey)
				.filter((key): key is string => key !== undefined));

		expect(placeholders.length).toBeGreaterThan(0);
		for (const key of placeholders)
			expect(FEATURE_MATCH_TOKEN_KEYS).toContain(key);
		// The side moved from the item into the key, so both players are nameable.
		expect(placeholders.some(key => key.startsWith('player1'))).toBe(true);
		expect(placeholders.some(key => key.startsWith('player2'))).toBe(true);
		expect(graphicsHostTokenCatalogue(FEATURE_MATCH_OVERLAY_HOST_CONTRACT).length).toBe(FEATURE_MATCH_TOKEN_KEYS.length);
	});

	it('row: image widget becomes a Media Graphic Item with an unfilled Graphic Asset slot', () => {
		const media = everyPresetItem().filter(item => item.type === 'media');

		expect(media.length).toBeGreaterThan(0);
		for (const item of media) {
			expect(item.mediaKind).toBe('image');
			expect(item.fit).toBe('contain');
			// A preset ships no content, so the slot the row is about is empty until an
			// author picks a revision. That the slot pins one exact Graphic Asset
			// Revision is covered by `test/unit/shared/graphicsAssetMediaReferences.test.ts`.
			expect(item.asset).toBeUndefined();
		}
	});

	it('row: clock, player-life, and game-wins widgets become context-gated shared Definitions', () => {
		const kinds = new Set(everyPresetItem().map(item => item.type));
		const featureMatchKinds = graphicItemDefinitionsForHost(FEATURE_MATCH_OVERLAY_HOST_CONTRACT).map(definition => definition.kind);
		const broadcastKinds = graphicItemDefinitionsForHost(BROADCAST_GRAPHICS_HOST_CONTRACT).map(definition => definition.kind);

		for (const kind of ['clock', 'player-life', 'game-wins'] as const) {
			expect(kinds).toContain(kind);
			expect(featureMatchKinds).toContain(kind);
			expect(broadcastKinds).not.toContain(kind);
		}
	});

	it('row: widget-group becomes a Graphic Group carrying its arrangement and clipping', () => {
		const groups = everyPresetItem().filter(item => item.type === 'group');

		expect(groups.length).toBeGreaterThan(0);
		for (const group of groups) {
			expect(['row', 'column', 'canvas']).toContain(group.arrangement);
			expect(typeof group.clip).toBe('boolean');
			// Graphic Groups do not nest.
			expect(group.children.some(child => (child as { type: string }).type === 'group')).toBe(false);
		}
	});

	it('row: numeric zIndex becomes back-to-front sibling list order', () => {
		const neon = FEATURE_MATCH_OVERLAY_PRESETS.find(preset => preset.id === 'neon-feature-match')!;

		// The scoreboard was authored last in the legacy list and stays last here,
		// which is the whole of what its old z-index said.
		expect(neon.config.layout.composition.items.at(-1)!.id).toBe('round-clock');
		expect(neon.config.layout.composition.items.map(item => item.id)).toContain('top-player-bar');
	});

	it('row: per-side border flags are dropped from Surface Style and composed as rule Shape Graphic Items', () => {
		for (const style of surfaceStyles()) {
			expect(style).not.toHaveProperty('borderTopVisible');
			expect(style).not.toHaveProperty('borderLeftVisible');
			// One uniform outline, or none.
			if (style.outline)
				expect(Object.keys(style.outline).toSorted()).toEqual(['color', 'width']);
		}

		const neon = FEATURE_MATCH_OVERLAY_PRESETS.find(preset => preset.id === 'neon-feature-match')!;
		const rules = presetItems(neon.config).filter(item => item.type === 'shape' && item.id.endsWith('-rule'));

		expect(rules.length).toBeGreaterThan(0);
		for (const rule of rules) {
			// A rule is a thin bed: one of its two extents collapses to the old
			// border width, and it carries its own Graphic Surface Style.
			expect(Math.min(rule.width, rule.height)).toBeLessThanOrEqual(4);
			expect(rule.type === 'shape' && rule.surfaceStyle).toBeTruthy();
		}
	});

	it('row: per-corner radii become Shape Geometry per-corner treatment', () => {
		// A type guard rather than a plain predicate, so the loop below can read
		// each item's geometry off the kind the filter established.
		const rounded = everyPresetItem().filter((item): item is Extract<GraphicItemConfig, { type: 'shape' | 'game-wins' }> =>
			(item.type === 'shape' && !isRectangularShapeGeometry(item.geometry))
			|| (item.type === 'game-wins' && !isRectangularShapeGeometry(item.boxGeometry)));

		expect(rounded.length).toBeGreaterThan(0);
		for (const item of rounded) {
			const geometry = item.type === 'game-wins' ? item.boxGeometry : item.geometry;
			expect(Object.keys(geometry).toSorted())
				.toEqual(['bottomLeft', 'bottomRight', 'leftSlant', 'rightSlant', 'topLeft', 'topRight']);
		}
	});

	it('row: box style becomes a Graphic Surface Style with a bounded Graphic Fill, and typography stays on the item', () => {
		const styles = surfaceStyles();
		const gradients = styles.filter(style => style.fill.type === 'linear-gradient');

		expect(styles.length).toBeGreaterThan(0);
		expect(gradients.length).toBeGreaterThan(0);
		for (const style of gradients) {
			if (style.fill.type !== 'linear-gradient')
				continue;
			expect(style.fill.stops.length).toBeGreaterThanOrEqual(MIN_GRAPHIC_FILL_STOPS);
			expect(style.fill.stops.length).toBeLessThanOrEqual(MAX_GRAPHIC_FILL_STOPS);
		}
		expect(styles.some(style => style.glow)).toBe(true);
		expect(styles.some(style => style.outline)).toBe(true);

		// Typography belongs to the Text Graphic Item, never to the surface.
		for (const style of styles)
			expect(style).not.toHaveProperty('fontSize');
		for (const item of everyPresetItem().filter(item => item.type === 'text'))
			expect(item.typography.fontSize).toBeGreaterThan(0);
	});

	it('row: text overflow becomes a Text Overflow Policy, and `visible` is gone', () => {
		const policies = new Set(everyPresetItem()
			.filter(item => item.type === 'text')
			.map(item => item.overflowPolicy));

		expect(policies.has('ellipsis')).toBe(true);
		expect(policies.has('shrink')).toBe(true);
		expect([...policies].every(policy => ['clip', 'ellipsis', 'shrink'].includes(policy))).toBe(true);
	});

	it('row: Frame, cutouts, and source roles stay on the host layer', () => {
		for (const preset of FEATURE_MATCH_OVERLAY_PRESETS) {
			expect(preset.config.layout.frame.backgroundColor).toBeTruthy();
			expect(preset.config.layout.sources.some(source => source.frameCutout)).toBe(true);
			expect(preset.config.layout.sources.map(source => source.sourceRole)).toContain('main');
		}

		const stacked = FEATURE_MATCH_OVERLAY_PRESETS.find(preset => preset.id === 'left-stacked-player-cams')!;
		expect(stacked.config.layout.sources.map(source => source.sourceRole))
			.toEqual(['main', 'player1', 'player2']);
	});
});
