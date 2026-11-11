import type { GraphicGroupChildConfig, GraphicItemConfig } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import { FEATURE_MATCH_LAYOUT_COMPOSITION_ID } from '~~/shared/featureMatchLayoutComposition';
import { FEATURE_MATCH_OVERLAY_PRESETS } from '~~/shared/featureMatchOverlayPresets';
import { FEATURE_MATCH_TOKEN_KEYS } from '~~/shared/featureMatchTokenCatalogue';
import { parseGraphicTextTemplate } from '~~/shared/modules/graphics';
import { featureMatchLayoutGraphicAssetReferences } from '~~/shared/utils/graphicsAssetReferences';

function everyPresetItem(): Array<GraphicItemConfig | GraphicGroupChildConfig> {
	return FEATURE_MATCH_OVERLAY_PRESETS.flatMap(preset => preset.config.layout.composition.items.flatMap(item =>
		item.type === 'group'
			? [item, ...item.children]
			: [item]));
}

describe('feature match overlay presets', () => {
	it('gives every preset the one stable Feature Match Layout composition id', () => {
		for (const preset of FEATURE_MATCH_OVERLAY_PRESETS)
			expect(preset.config.layout.composition.id).toBe(FEATURE_MATCH_LAYOUT_COMPOSITION_ID);
	});

	// A built-in is on every installation, so it can depend on no Graphic Asset of one.
	it('pins no Graphic Asset Revision', () => {
		for (const preset of FEATURE_MATCH_OVERLAY_PRESETS)
			expect(featureMatchLayoutGraphicAssetReferences(preset.config.layout), preset.id).toEqual([]);
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
