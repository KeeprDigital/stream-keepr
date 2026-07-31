import { describe, expect, it } from 'vitest';
import { createFeatureMatchLayoutComposition } from '~~/shared/featureMatchLayoutComposition';
import { applyFeatureMatchOverlayPreset, FEATURE_MATCH_OVERLAY_PRESETS } from '~~/shared/featureMatchOverlayPresets';
import { getGraphicItemDefinition } from '~~/shared/modules/graphics';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';

describe('broadcast layout presets', () => {
	it('preserves the selected feature match when applying a preset', () => {
		const config = { ...DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG, featureMatchId: 42 };
		const result = applyFeatureMatchOverlayPreset(config, 'full-table');

		expect(result.featureMatchId).toBe(42);
		expect(result.presetId).toBe('full-table');
		expect(result.layout.items.filter(item => item.type === 'source')).toHaveLength(1);
		expect(result.layout.items.find(item => item.id === 'top-bar')?.x).toBe(24);
		expect(result.layout.items.find(item => item.id === 'top-bar')?.width).toBe(1872);
	});

	it('preserves the shared item tree when applying or resetting a preset', () => {
		// A preset initialises the legacy widget layout, and no preset carries a shared
		// composition. Spreading one over the current layout would silently delete every
		// Graphic Item an author had built on the compositor — and "Reset" is one
		// unconfirmed click beside the preset select.
		const config = {
			...DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG,
			layout: {
				...DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG.layout,
				composition: {
					...createFeatureMatchLayoutComposition(),
					items: [getGraphicItemDefinition('clock').createDefault({
						id: 'clock',
						label: 'Clock',
						canvasWidth: 1920,
						canvasHeight: 1080,
					})],
				},
			},
		};

		for (const presetId of ['full-table', config.presetId] as const) {
			const result = applyFeatureMatchOverlayPreset(config, presetId);

			expect(result.layout.composition?.items.map(item => item.id)).toEqual(['clock']);
		}
	});

	it('leaves a layout with no shared item tree without one', () => {
		// Preserving the tree must not mean inventing an empty one: an absent
		// composition stays absent, so applying a preset changes nothing it did not own.
		const result = applyFeatureMatchOverlayPreset(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG, 'full-table');

		expect(result.layout.composition).toBeUndefined();
	});

	it('ships presets with Source Items, Graphic Groups, and atomic Graphic Items', () => {
		for (const preset of FEATURE_MATCH_OVERLAY_PRESETS) {
			const items = preset.config.layout.items;
			const groups = items.filter(item => item.type === 'graphic-group');
			const graphicItems = [
				...items.filter(item => item.type === 'graphic-item').map(item => item.graphicItem.type),
				...groups.flatMap(group => group.children.map(child =>
					child.type === 'media' ? child.mediaKind : child.graphicItem.type)),
			];

			expect(items.some(item => item.type === 'source')).toBe(true);
			expect(groups.length).toBeGreaterThan(0);
			expect(graphicItems).toEqual(expect.arrayContaining(['text', 'image', 'clock', 'player-life', 'game-wins']));
		}
	});

	it('preserves each built-in preset previous effective Graphic Layer Order', () => {
		expect(Object.fromEntries(FEATURE_MATCH_OVERLAY_PRESETS.map(preset => [
			preset.id,
			preset.config.layout.items.map(item => item.id),
		]))).toEqual({
			'full-table': [
				'main-source',
				'top-bar',
				'bottom-bar',
				'player1-game-wins',
				'player2-game-wins',
				'branding',
			],
			'left-stacked-player-cams': [
				'main-source',
				'player1-source',
				'player2-source',
				'top-bar',
				'bottom-bar',
				'player1-game-wins',
				'player2-game-wins',
				'branding',
			],
			'neon-feature-match': [
				'upper-neon-rail',
				'left-empty-panel',
				'left-branding',
				'left-footer-panel',
				'right-branding',
				'right-footer-panel',
				'main-source',
				'player1-source',
				'player2-source',
				'top-player-bar',
				'round-clock',
			],
		});
	});
});
