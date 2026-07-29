import { describe, expect, it } from 'vitest';
import { FEATURE_MATCH_OVERLAY_GRAPHIC_ITEM_TYPES, featureMatchOverlayGraphicItemDefinition } from '~~/app/modules/feature-match-overlay/graphicItemDefinitions';

describe('feature Match Overlay GraphicItem Definitions', () => {
	it('defines every graphicItem type exactly once', () => {
		expect([...FEATURE_MATCH_OVERLAY_GRAPHIC_ITEM_TYPES].sort()).toEqual(
			['clock', 'game-wins', 'player-life', 'text'].sort(),
		);
	});

	it('provides label, icon, and a valid default config per type', () => {
		for (const type of FEATURE_MATCH_OVERLAY_GRAPHIC_ITEM_TYPES) {
			const definition = featureMatchOverlayGraphicItemDefinition(type);
			expect(definition.id).toBe(type);
			expect(definition.configurationVersion).toBe(1);
			expect(Array.isArray(definition.editorControls)).toBe(true);
			expect(definition.schema).toBeTypeOf('function');
			expect(definition.render).toBeTypeOf('function');
			expect(definition.migrate).toBeTypeOf('function');
			expect(definition.discoverAssetReferences).toBeTypeOf('function');
			expect(definition.label.length).toBeGreaterThan(0);
			expect(definition.icon).toMatch(/^i-lucide-/);
			expect(definition.defaultConfig().type).toBe(type);
		}
	});

	it('owns renderer dispatch and configuration-version migration', () => {
		const definition = featureMatchOverlayGraphicItemDefinition('clock');
		const config = definition.defaultConfig();
		expect(definition.render(config, {
			text: () => 'text',
			clock: () => 'clock',
			playerLife: () => 'life',
			gameWins: () => 'wins',
		})).toBe('clock');
		expect(definition.migrate(config, definition.configurationVersion)).toBe(config);
		expect(() => definition.migrate(config, 2)).toThrow(
			'Unsupported Graphic Item configuration version 2.',
		);
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
	});

	it('default configs are fresh objects each call', () => {
		const definition = featureMatchOverlayGraphicItemDefinition('game-wins');
		expect(definition.defaultConfig()).not.toBe(definition.defaultConfig());
	});
});
