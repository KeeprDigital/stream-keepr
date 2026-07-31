import { describe, expect, it } from 'vitest';
import { FEATURE_MATCH_LAYOUT_COMPOSITION_ID } from '~~/shared/featureMatchLayoutComposition';
import { applyFeatureMatchOverlayPreset, FEATURE_MATCH_OVERLAY_PRESETS } from '~~/shared/featureMatchOverlayPresets';
import { getGraphicItemDefinition } from '~~/shared/modules/graphics';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';

describe('feature match overlay presets', () => {
	it('preserves the selected Feature Match Slot when applying a preset', () => {
		const config = { ...DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG, featureMatchId: 42 };

		const result = applyFeatureMatchOverlayPreset(config, 'full-table');

		expect(result.featureMatchId).toBe(42);
		expect(result.presetId).toBe('full-table');
	});

	it('replaces the whole layout, because a preset now owns every part of one', () => {
		// Before the shared compositor a preset only initialised the legacy widget
		// list, so applying one had to carry the shared item tree across or a click
		// on "Reset" would delete it. A preset now ships the tree itself, so nothing
		// is carried and nothing is half-replaced.
		const authored = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		authored.layout.composition.items = [getGraphicItemDefinition('clock').createDefault({
			id: 'my-clock',
			label: 'My Clock',
			canvasWidth: 1920,
			canvasHeight: 1080,
		})];
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

	it('keeps each built-in preset previous Graphic Layer Order', () => {
		expect(Object.fromEntries(FEATURE_MATCH_OVERLAY_PRESETS.map(preset => [
			preset.id,
			{
				sources: preset.config.layout.sources.map(source => source.id),
				items: preset.config.layout.composition.items.map(item => item.id),
			},
		]))).toEqual({
			'full-table': {
				sources: ['main-source'],
				items: ['top-bar', 'bottom-bar', 'player1-game-wins', 'player2-game-wins', 'branding'],
			},
			'left-stacked-player-cams': {
				sources: ['main-source', 'player1-source', 'player2-source'],
				items: ['top-bar', 'bottom-bar', 'player1-game-wins', 'player2-game-wins', 'branding'],
			},
			'neon-feature-match': {
				sources: ['main-source', 'player1-source', 'player2-source'],
				items: [
					'upper-neon-rail',
					'left-empty-panel',
					'left-branding',
					'left-footer-panel',
					'right-branding',
					'right-footer-panel',
					'top-player-bar',
					'round-clock',
				],
			},
		});
	});

	it('keeps every Graphic Item id unique within a preset, including group children', () => {
		for (const preset of FEATURE_MATCH_OVERLAY_PRESETS) {
			const ids = preset.config.layout.composition.items.flatMap(item =>
				item.type === 'group' ? [item.id, ...item.children.map(child => child.id)] : [item.id]);

			expect(new Set(ids).size, preset.id).toBe(ids.length);
		}
	});
});
