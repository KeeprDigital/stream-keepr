import { describe, expect, it } from 'vitest';
import { FEATURE_MATCH_OVERLAY_GRAPHIC_ITEM_TYPES, featureMatchOverlayGraphicItemDefinition } from '~~/app/modules/feature-match-overlay/graphicItemDefinitions';

describe('feature Match Overlay Graphic Item Definitions', () => {
	it('defines every Graphic Item kind exactly once', () => {
		expect([...FEATURE_MATCH_OVERLAY_GRAPHIC_ITEM_TYPES].sort()).toEqual(
			['clock', 'game-wins', 'graphic-group', 'media', 'player-life', 'text'].sort(),
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
			expect(definition.defaultConfig().configurationVersion).toBe(1);
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
			media: () => 'media',
			graphicGroup: () => 'group',
		})).toBe('clock');
		expect(definition.migrate(config, definition.configurationVersion)).toBe(config);
		expect(definition.migrate({ type: 'clock' }, undefined)).toEqual({
			type: 'clock',
			configurationVersion: 1,
		});
		expect(() => definition.migrate(config, 2)).toThrow(
			'Unsupported Graphic Item configuration version 2.',
		);
	});

	it('keeps the established editor labels', () => {
		expect(featureMatchOverlayGraphicItemDefinition('text').label).toBe('Text');
		expect(featureMatchOverlayGraphicItemDefinition('player-life').label).toBe('Life');
		expect(featureMatchOverlayGraphicItemDefinition('game-wins').label).toBe('Wins');
	});

	it('summarizes Graphic Item configs', () => {
		expect(featureMatchOverlayGraphicItemDefinition('text').summary({ type: 'text', template: '{name}' })).toBe('{name}');
		expect(featureMatchOverlayGraphicItemDefinition('clock').summary({ type: 'clock' })).toBe('Live clock');
		expect(featureMatchOverlayGraphicItemDefinition('player-life').summary({ type: 'player-life', playerSide: 'player2' })).toBe('player2 life');
		expect(featureMatchOverlayGraphicItemDefinition('media').summary({
			...featureMatchOverlayGraphicItemDefinition('media').defaultConfig(),
			mediaKind: 'silent-video',
		})).toBe('choose an asset');
		expect(featureMatchOverlayGraphicItemDefinition('graphic-group').summary({
			...featureMatchOverlayGraphicItemDefinition('graphic-group').defaultConfig(),
			children: [],
		})).toBe('0 Graphic Items');
	});

	it('default configs are fresh objects each call', () => {
		const definition = featureMatchOverlayGraphicItemDefinition('game-wins');
		expect(definition.defaultConfig()).not.toBe(definition.defaultConfig());
	});
});
