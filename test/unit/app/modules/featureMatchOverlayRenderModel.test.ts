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
				framingStyle: { borderVisible: true, borderColor: '#ffffff', borderWidth: 3, borderLeftVisible: false },
			})]),
			output: 'overlay',
		});

		expect(model.sourceItems[0]!.style).toMatchObject({
			borderTop: '3px solid #ffffff',
			borderLeft: 'none',
		});
	});

	it('derives the Source Item glow from its rounded border', () => {
		const framingStyle = {
			borderVisible: true,
			borderColor: '#0077a3',
			borderWidth: 4,
			borderRadius: 8,
			borderRadiusTopLeft: 12,
			borderRadiusTopRight: 4,
			borderRadiusBottomLeft: 6,
			glowColor: '#ffffff',
			glowSize: 10,
			glowOpacity: 0.5,
		};
		const overlay = resolveFeatureMatchOverlayRenderModel({
			config: configWith([source({ framingStyle })]),
			output: 'overlay',
		});
		const key = resolveFeatureMatchOverlayRenderModel({
			config: configWith([source({ framingStyle })]),
			output: 'key',
		});

		expect(overlay.sourceItems[0]!.style).not.toHaveProperty('boxShadow');
		expect(overlay.sourceItems[0]!.glowContainerStyle).toMatchObject({
			left: '70px',
			top: '20px',
			width: '460px',
			height: '260px',
			overflow: 'hidden',
		});
		expect(overlay.sourceItems[0]!.glowContainerStyle).not.toHaveProperty('maskImage');
		expect(overlay.sourceItems[0]!.glowStyle).toMatchObject({
			left: '30px',
			top: '30px',
			width: '400px',
			height: '200px',
			borderRadius: '12px 4px 8px 6px',
			borderTop: '4px solid #0077a3',
			filter: 'drop-shadow(0 0 10px rgba(255, 255, 255, 0.5))',
		});
		expect(key.sourceItems[0]!.glowContainerStyle).toBeUndefined();
		expect(key.sourceItems[0]!.glowStyle).toBeUndefined();
	});

	it('masks a Source Item glow to only the selected side of its rounded border', () => {
		const framingStyle = {
			borderVisible: true,
			borderColor: '#ffffff',
			borderWidth: 2,
			borderRadius: 8,
			glowColor: '#ffffff',
			glowSize: 10,
			glowOpacity: 1,
		};
		const maskFor = (glowPosition: 'inside' | 'outside') => {
			const model = resolveFeatureMatchOverlayRenderModel({
				config: configWith([source({ framingStyle: { ...framingStyle, glowPosition } })]),
				output: 'overlay',
			});
			return decodeURIComponent(String(model.sourceItems[0]!.glowContainerStyle!.maskImage));
		};

		const insideMask = maskFor('inside');
		const outsideMask = maskFor('outside');

		expect(insideMask).toContain('<path d="M 38 30');
		expect(insideMask).not.toContain('M 0 0 H 460 V 260');
		expect(outsideMask).toContain('<path d="M 0 0 H 460 V 260 H 0 Z M 38 30');
		expect(outsideMask).toContain('fill-rule="evenodd"');
	});

	it('keeps the background gradient, which the host layer did not drop either', () => {
		// The shared Graphic Fill replaced arbitrary CSS gradients with two-to-four
		// positioned stops, but that rule is the shared vocabulary's own. A Source
		// Item paints the string the Frame beside it still paints.
		const gradient = 'linear-gradient(90deg, #b80054, #7f22f6)';
		const model = resolveFeatureMatchOverlayRenderModel({
			config: configWith([source({ framingStyle: { backgroundGradient: gradient } })]),
			output: 'overlay',
		});
		const overBase = resolveFeatureMatchOverlayRenderModel({
			config: configWith([source({
				framingStyle: { backgroundGradient: gradient, backgroundColor: '#001122', backgroundOpacity: 0.5 },
			})]),
			output: 'overlay',
		});
		const key = resolveFeatureMatchOverlayRenderModel({
			config: configWith([source({ framingStyle: { backgroundGradient: gradient } })]),
			output: 'key',
		});

		// A gradient alone is fully opaque, as it was before the rewrite.
		expect(model.sourceItems[0]!.style.background).toBe(gradient);
		expect(overBase.sourceItems[0]!.style.background).toBe(`${gradient}, rgba(0, 17, 34, 0.5)`);
		// A Key Output is a matte: the gradient becomes coverage, not colour.
		expect(key.sourceItems[0]!.style.background).toBe('#ffffffff');
	});

	it('paints the Key Output in white and the Fill Output over black', () => {
		const key = resolveFeatureMatchOverlayRenderModel({
			config: configWith([source({ framingStyle: { borderVisible: true, borderColor: '#0077a3', borderWidth: 4 } })]),
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
