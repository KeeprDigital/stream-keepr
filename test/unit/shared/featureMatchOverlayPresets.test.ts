import type { GraphicGroupChildConfig, GraphicItemConfig, GraphicSurfaceStyle } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import { FEATURE_MATCH_LAYOUT_COMPOSITION_ID } from '~~/shared/featureMatchLayoutComposition';
import { applyFeatureMatchOverlayPreset, FEATURE_MATCH_OVERLAY_PRESETS } from '~~/shared/featureMatchOverlayPresets';
import { FEATURE_MATCH_TOKEN_KEYS } from '~~/shared/featureMatchTokenCatalogue';
import { getGraphicItemDefinition, parseGraphicTextTemplate } from '~~/shared/modules/graphics';
import { MAX_GRAPHIC_FILL_STOPS, MIN_GRAPHIC_FILL_STOPS } from '~~/shared/types/graphics';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';

function everyPresetItem(): Array<GraphicItemConfig | GraphicGroupChildConfig> {
	return FEATURE_MATCH_OVERLAY_PRESETS.flatMap(preset => preset.config.layout.composition.items.flatMap(item =>
		item.type === 'group'
			? [item, ...item.children]
			: [item]));
}

function presetSurfaceStyles(): GraphicSurfaceStyle[] {
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

describe('feature match overlay presets', () => {
	it('preserves the selected Feature Match Slot when applying a preset', () => {
		const config = { ...DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG, featureMatchId: 42 };

		const result = applyFeatureMatchOverlayPreset(config, 'full-table');

		expect(result.featureMatchId).toBe(42);
		expect(result.presetId).toBe('full-table');
	});

	it('replaces the whole layout rather than carrying authored items across', () => {
		const authored = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		authored.layout.composition.items = [
			getGraphicItemDefinition('clock').createDefault({
				id: 'my-clock',
				label: 'My Clock',
				canvasWidth: 1920,
				canvasHeight: 1080,
			}),
		];
		authored.layout.sources = [];

		const result = applyFeatureMatchOverlayPreset(authored, 'full-table');

		expect(result.layout.composition.items.map(item => item.id)).not.toContain('my-clock');
		expect(result.layout.sources).not.toEqual([]);
	});

	it('gives every preset the one stable Feature Match Layout composition id', () => {
		for (const preset of FEATURE_MATCH_OVERLAY_PRESETS)
			expect(preset.config.layout.composition.id).toBe(FEATURE_MATCH_LAYOUT_COMPOSITION_ID);
	});

	it('hands out copies, so applying a preset twice cannot share nested objects', () => {
		const first = applyFeatureMatchOverlayPreset(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG, 'neon-feature-match');
		const second = applyFeatureMatchOverlayPreset(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG, 'neon-feature-match');

		first.layout.composition.items[0]!.label = 'Renamed';

		expect(second.layout.composition.items[0]!.label).not.toBe('Renamed');
	});

	it('keeps every Graphic Item id unique within a preset, including group children', () => {
		for (const preset of FEATURE_MATCH_OVERLAY_PRESETS) {
			const ids = preset.config.layout.composition.items.flatMap(item =>
				item.type === 'group'
					? [
							item.id,
							...item.children.map(child => child.id),
						]
					: [item.id]);

			expect(new Set(ids).size, preset.id).toBe(ids.length);
		}
	});

	it('only names tokens the Feature Match token catalogue provides', () => {
		const placeholders = everyPresetItem()
			.filter(item => item.type === 'text')
			.flatMap(item => parseGraphicTextTemplate(item.text)
				.map(segment => segment.inputKey)
				.filter((key): key is string => key !== undefined));

		expect(placeholders.length).toBeGreaterThan(0);
		for (const key of placeholders)
			expect(FEATURE_MATCH_TOKEN_KEYS).toContain(key);
	});

	it('never nests a Graphic Group inside another', () => {
		for (const group of everyPresetItem().filter(item => item.type === 'group'))
			expect(group.children.some(child => (child as { type: string }).type === 'group')).toBe(false);
	});

	it('keeps every gradient fill within the Graphic Fill stop bounds', () => {
		const gradients = presetSurfaceStyles().filter(style => style.fill.type === 'linear-gradient');

		expect(gradients.length).toBeGreaterThan(0);
		for (const style of gradients) {
			if (style.fill.type !== 'linear-gradient')
				continue;
			expect(style.fill.stops.length).toBeGreaterThanOrEqual(MIN_GRAPHIC_FILL_STOPS);
			expect(style.fill.stops.length).toBeLessThanOrEqual(MAX_GRAPHIC_FILL_STOPS);
		}
	});
});
