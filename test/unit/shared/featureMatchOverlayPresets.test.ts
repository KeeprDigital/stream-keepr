import { describe, expect, it } from 'vitest';
import { applyFeatureMatchOverlayPreset, FEATURE_MATCH_OVERLAY_PRESETS } from '~~/shared/featureMatchOverlayPresets';
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

	it('ships presets with Source Items, Widget Groups, and atomic widgets', () => {
		for (const preset of FEATURE_MATCH_OVERLAY_PRESETS) {
			const items = preset.config.layout.items;
			const groups = items.filter(item => item.type === 'widget-group');
			const widgets = [
				...items.filter(item => item.type === 'widget').map(item => item.widget.type),
				...groups.flatMap(group => group.children.map(child =>
					child.type === 'media' ? child.mediaKind : child.widget.type)),
			];

			expect(items.some(item => item.type === 'source')).toBe(true);
			expect(groups.length).toBeGreaterThan(0);
			expect(widgets).toEqual(expect.arrayContaining(['text', 'image', 'clock', 'player-life', 'game-wins']));
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
