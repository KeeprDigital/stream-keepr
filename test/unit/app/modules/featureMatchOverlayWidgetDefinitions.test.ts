import { describe, expect, it } from 'vitest';
import { FEATURE_MATCH_OVERLAY_GRAPHIC_ITEM_TYPES, featureMatchOverlayGraphicItemDefinition } from '~~/app/modules/feature-match-overlay/graphicItemDefinitions';

describe('feature Match Overlay GraphicItem Definitions', () => {
	it('defines every graphicItem type exactly once', () => {
		expect([...FEATURE_MATCH_OVERLAY_GRAPHIC_ITEM_TYPES].sort()).toEqual(
			['clock', 'game-wins', 'image', 'player-life', 'text'].sort(),
		);
	});

	it('provides label, icon, and a valid default config per type', () => {
		for (const type of FEATURE_MATCH_OVERLAY_GRAPHIC_ITEM_TYPES) {
			const definition = featureMatchOverlayGraphicItemDefinition(type);
			expect(definition.label.length).toBeGreaterThan(0);
			expect(definition.icon).toMatch(/^i-lucide-/);
			expect(definition.defaultConfig().type).toBe(type);
		}
	});

	it('keeps the established editor labels', () => {
		expect(featureMatchOverlayGraphicItemDefinition('text').label).toBe('Text');
		expect(featureMatchOverlayGraphicItemDefinition('player-life').label).toBe('Life');
		expect(featureMatchOverlayGraphicItemDefinition('game-wins').label).toBe('Wins');
	});

	it('summarizes graphicItem configs', () => {
		expect(featureMatchOverlayGraphicItemDefinition('text').summary({ type: 'text', template: '{name}' })).toBe('{name}');
		expect(featureMatchOverlayGraphicItemDefinition('clock').summary({ type: 'clock' })).toBe('Live clock');
		expect(featureMatchOverlayGraphicItemDefinition('player-life').summary({ type: 'player-life', playerSide: 'player2' })).toBe('player2 life');
		expect(featureMatchOverlayGraphicItemDefinition('image').summary({ type: 'image', fit: 'contain', opacity: 1, borderRadius: 0 })).toBe('Image');
	});

	it('default configs are fresh objects each call', () => {
		const definition = featureMatchOverlayGraphicItemDefinition('game-wins');
		expect(definition.defaultConfig()).not.toBe(definition.defaultConfig());
	});
});
