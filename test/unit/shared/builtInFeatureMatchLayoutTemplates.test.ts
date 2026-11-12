import type { GraphicGroupChildConfig, GraphicItemConfig } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import { BUILT_IN_FEATURE_MATCH_LAYOUT_TEMPLATES } from '~~/shared/builtInFeatureMatchLayoutTemplates';
import { FEATURE_MATCH_LAYOUT_COMPOSITION_ID } from '~~/shared/featureMatchLayoutComposition';
import { FEATURE_MATCH_TOKEN_KEYS } from '~~/shared/featureMatchTokenCatalogue';
import { parseGraphicTextTemplate } from '~~/shared/modules/graphics';
import { featureMatchLayoutGraphicAssetReferences } from '~~/shared/utils/graphicsAssetReferences';

function everyBuiltInItem(): Array<GraphicItemConfig | GraphicGroupChildConfig> {
	return BUILT_IN_FEATURE_MATCH_LAYOUT_TEMPLATES.flatMap(builtIn => builtIn.config.layout.composition.items.flatMap(item =>
		item.type === 'group'
			? [item, ...item.children]
			: [item]));
}

describe('the built-in Feature Match Layout Templates', () => {
	it('gives every one the one stable Feature Match Layout composition id', () => {
		for (const builtIn of BUILT_IN_FEATURE_MATCH_LAYOUT_TEMPLATES)
			expect(builtIn.config.layout.composition.id).toBe(FEATURE_MATCH_LAYOUT_COMPOSITION_ID);
	});

	// A built-in is on every installation, so it can depend on no Graphic Asset of one.
	it('pins no Graphic Asset Revision', () => {
		for (const builtIn of BUILT_IN_FEATURE_MATCH_LAYOUT_TEMPLATES)
			expect(featureMatchLayoutGraphicAssetReferences(builtIn.config.layout), builtIn.id).toEqual([]);
	});

	it('keeps every Graphic Item id unique within one, including group children', () => {
		for (const builtIn of BUILT_IN_FEATURE_MATCH_LAYOUT_TEMPLATES) {
			const ids = builtIn.config.layout.composition.items.flatMap(item =>
				item.type === 'group'
					? [
							item.id,
							...item.children.map(child => child.id),
						]
					: [item.id]);

			expect(new Set(ids).size, builtIn.id).toBe(ids.length);
		}
	});

	it('only names tokens the Feature Match token catalogue provides', () => {
		const placeholders = everyBuiltInItem()
			.filter(item => item.type === 'text')
			.flatMap(item => parseGraphicTextTemplate(item.text)
				.map(segment => segment.inputKey)
				.filter((key): key is string => key !== undefined));

		expect(placeholders.length).toBeGreaterThan(0);
		for (const key of placeholders)
			expect(FEATURE_MATCH_TOKEN_KEYS).toContain(key);
	});

	it('never nests a Graphic Group inside another', () => {
		for (const group of everyBuiltInItem().filter(item => item.type === 'group'))
			expect(group.children.some(child => (child as { type: string }).type === 'group')).toBe(false);
	});

	// Placed under any Theme, a built-in follows it: its text, panels and branding bind Foundation Tokens.
	it.each([
		{ kind: 'text', slot: 'typography.color', token: 'text-primary' },
		{ kind: 'shape', slot: 'surfaceStyle', token: 'panel' },
		{ kind: 'media', slot: 'media', token: 'logo' },
	] as const)('binds every $kind item\'s $slot to $token', ({ kind, slot, token }) => {
		const items = everyBuiltInItem().filter(item => item.type === kind && item.id !== 'branding-image-2');

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
		for (const builtIn of BUILT_IN_FEATURE_MATCH_LAYOUT_TEMPLATES) {
			const hosts = [
				builtIn.config.layout.frame,
				...builtIn.config.layout.sources.map(source => source.framingStyle ?? {}),
			];
			for (const host of hosts)
				expect(Object.keys(host).filter(key => looks.includes(key)), builtIn.id).toEqual([]);
			expect(Object.keys(builtIn.config.layout.frame.animation ?? {}).sort()).toEqual(['enabled', 'opacity']);
		}
	});
});
