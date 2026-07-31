import type { FeatureMatchOverlayModeConfig, FeatureMatchSourceItemConfig } from '~~/shared/types/screenConfig';
import { describe, expect, it } from 'vitest';
import { resolveFeatureMatchOverlayRenderModel } from '~~/app/modules/feature-match-overlay/renderModel';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';

/**
 * The host-owned render model: the Frame and the Source Items placed against it.
 *
 * Everything else a Feature Match Layout draws is the shared compositor's, and is
 * covered by the shared render-model suite. What is asserted here is what only
 * this host does: an external video source area, the cutout it punches through the
 * Frame, and the Fill and Key Output derivations of both.
 */

function configWith(sources: FeatureMatchSourceItemConfig[]): FeatureMatchOverlayModeConfig {
	const base = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
	return { ...base, layout: { ...base.layout, sources } };
}

function source(overrides: Partial<FeatureMatchSourceItemConfig> = {}): FeatureMatchSourceItemConfig {
	return {
		id: 's1',
		label: 'Main',
		visible: true,
		x: 100,
		y: 50,
		width: 400,
		height: 200,
		sourceRole: 'main',
		frameCutout: true,
		...overrides,
	};
}

describe('feature match overlay host render model', () => {
	it('places each visible Source Item at its authored rectangle', () => {
		const model = resolveFeatureMatchOverlayRenderModel({
			config: configWith([source()]),
			output: 'overlay',
		});

		expect(model.sourceItems).toHaveLength(1);
		expect(model.sourceItems[0]!.style).toMatchObject({
			left: '100px',
			top: '50px',
			width: '400px',
			height: '200px',
		});
	});

	it('omits a hidden Source Item and its cutout', () => {
		const model = resolveFeatureMatchOverlayRenderModel({
			config: configWith([source({ visible: false })]),
			output: 'overlay',
		});

		expect(model.sourceItems).toEqual([]);
		expect(model.sourceCutouts).toEqual([]);
	});

	it('cuts a Source Item through the Frame only when it asks to', () => {
		const cutting = resolveFeatureMatchOverlayRenderModel({
			config: configWith([source()]),
			output: 'overlay',
		});
		const solid = resolveFeatureMatchOverlayRenderModel({
			config: configWith([source({ frameCutout: false })]),
			output: 'overlay',
		});

		expect(cutting.sourceCutouts.map(cutout => cutout.id)).toEqual(['s1']);
		expect(solid.sourceCutouts).toEqual([]);
	});

	it('keeps per-side border visibility, which the host layer did not drop', () => {
		const model = resolveFeatureMatchOverlayRenderModel({
			config: configWith([source({
				surfaceStyle: { borderVisible: true, borderColor: '#ffffff', borderWidth: 3, borderLeftVisible: false },
			})]),
			output: 'overlay',
		});

		expect(model.sourceItems[0]!.style).toMatchObject({
			borderTop: '3px solid #ffffff',
			borderLeft: 'none',
		});
	});

	it('paints the Key Output in white and the Fill Output over black', () => {
		const key = resolveFeatureMatchOverlayRenderModel({
			config: configWith([source({ surfaceStyle: { borderVisible: true, borderColor: '#0077a3', borderWidth: 4 } })]),
			output: 'key',
		});
		const fill = resolveFeatureMatchOverlayRenderModel({ config: configWith([]), output: 'fill' });

		expect(key.sourceItems[0]!.style.borderTop).toBe('4px solid #fff');
		expect(key.frame.fill).toBe('#fff');
		expect(fill.canvasStyle.background).toBe('#000');
	});

	it('renders an overlay canvas transparent', () => {
		const model = resolveFeatureMatchOverlayRenderModel({ config: configWith([]), output: 'overlay' });

		expect(model.canvasStyle.background).toBe('transparent');
	});
});
