import { describe, expect, it } from 'vitest';
import { FEATURE_MATCH_OVERLAY_WIDGET_TYPES, featureMatchOverlayWidgetDefinition } from '~~/app/modules/feature-match-overlay/widgetDefinitions';

describe('feature Match Overlay Widget Definitions', () => {
	it('defines every widget type exactly once', () => {
		expect([...FEATURE_MATCH_OVERLAY_WIDGET_TYPES].sort()).toEqual(
			['clock', 'game-wins', 'image', 'player-life', 'text'].sort(),
		);
	});

	it('provides label, icon, and a valid default config per type', () => {
		for (const type of FEATURE_MATCH_OVERLAY_WIDGET_TYPES) {
			const definition = featureMatchOverlayWidgetDefinition(type);
			expect(definition.label.length).toBeGreaterThan(0);
			expect(definition.icon).toMatch(/^i-lucide-/);
			expect(definition.defaultConfig().type).toBe(type);
		}
	});

	it('keeps the established editor labels', () => {
		expect(featureMatchOverlayWidgetDefinition('text').label).toBe('Text');
		expect(featureMatchOverlayWidgetDefinition('player-life').label).toBe('Life');
		expect(featureMatchOverlayWidgetDefinition('game-wins').label).toBe('Wins');
	});

	it('summarizes widget configs', () => {
		expect(featureMatchOverlayWidgetDefinition('text').summary({ type: 'text', template: '{name}' })).toBe('{name}');
		expect(featureMatchOverlayWidgetDefinition('clock').summary({ type: 'clock' })).toBe('Live clock');
		expect(featureMatchOverlayWidgetDefinition('player-life').summary({ type: 'player-life', playerSide: 'player2' })).toBe('player2 life');
		expect(featureMatchOverlayWidgetDefinition('image').summary({ type: 'image', url: '', fit: 'contain', opacity: 1, borderRadius: 0 })).toBe('Image');
	});

	it('default configs are fresh objects each call', () => {
		const definition = featureMatchOverlayWidgetDefinition('game-wins');
		expect(definition.defaultConfig()).not.toBe(definition.defaultConfig());
	});
});
