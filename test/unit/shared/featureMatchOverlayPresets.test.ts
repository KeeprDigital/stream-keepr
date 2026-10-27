import type { GraphicGroupChildConfig, GraphicItemConfig } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import { FEATURE_MATCH_LAYOUT_COMPOSITION_ID } from '~~/shared/featureMatchLayoutComposition';
import { applyFeatureMatchOverlayPreset, FEATURE_MATCH_OVERLAY_PRESETS } from '~~/shared/featureMatchOverlayPresets';
import { FEATURE_MATCH_TOKEN_KEYS } from '~~/shared/featureMatchTokenCatalogue';
import { getGraphicItemDefinition, parseGraphicTextTemplate } from '~~/shared/modules/graphics';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';

function everyPresetItem(): Array<GraphicItemConfig | GraphicGroupChildConfig> {
	return FEATURE_MATCH_OVERLAY_PRESETS.flatMap(preset => preset.config.layout.composition.items.flatMap(item =>
		item.type === 'group'
			? [item, ...item.children]
			: [item]));
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

	// Placed under any Theme, a preset follows it: its text, panels and branding bind Foundation Tokens.
	it.each([
		{ kind: 'text', slot: 'typography.color', token: 'text-primary' },
		{ kind: 'shape', slot: 'surfaceStyle', token: 'panel' },
		{ kind: 'media', slot: 'media', token: 'logo' },
	] as const)('binds every $kind item\'s $slot to $token', ({ kind, slot, token }) => {
		const items = everyPresetItem().filter(item => item.type === kind && item.id !== 'branding-image-2');

		expect(items.length).toBeGreaterThan(0);
		for (const item of items)
			expect(item.themeBindings?.[slot], item.id).toBe(token);
	});

	it('carries no raw CSS gradient, colour, border or glow on its Frame or Source Items', () => {
		const looks = [
			'backgroundColor',
			'gradient',
			'backgroundGradient',
			'backgroundOpacity',
			'borderVisible',
			'borderColor',
			'borderWidth',
			'glowColor',
			'glowSize',
			'glowOpacity',
		];
		for (const preset of FEATURE_MATCH_OVERLAY_PRESETS) {
			const hosts = [
				preset.config.layout.frame,
				...preset.config.layout.sources.map(source => source.framingStyle ?? {}),
			];
			for (const host of hosts)
				expect(Object.keys(host).filter(key => looks.includes(key)), preset.id).toEqual([]);
			expect(Object.keys(preset.config.layout.frame.animation ?? {}).sort()).toEqual(['enabled', 'opacity']);
		}
	});
});
