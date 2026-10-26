import type {
	FeatureMatchOverlayFrameConfig,
	FeatureMatchOverlayModeConfig,
	FeatureMatchOverlayOutput,
	FeatureMatchSourceItemConfig,
} from '~~/shared/types/screenConfig';
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
	return {
		...base,
		layout: { ...base.layout, sources },
	};
}

function frameModel(output: FeatureMatchOverlayOutput, frame: Partial<FeatureMatchOverlayFrameConfig>) {
	const base = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
	return resolveFeatureMatchOverlayRenderModel({
		config: {
			...base,
			layout: {
				...base.layout,
				frame: { backgroundColor: '#101820', opacity: 0.9, ...frame },
			},
		},
		output,
		frameGlowFilterId: 'frame-glow',
	}).frame;
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
			config: configWith([
				source(),
			]),
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
			config: configWith([
				source({ visible: false }),
			]),
			output: 'overlay',
		});

		expect(model.sourceItems).toEqual([]);
		expect(model.sourceCutouts).toEqual([]);
	});

	it('cuts a Source Item through the Frame only when it asks to', () => {
		const cutting = resolveFeatureMatchOverlayRenderModel({
			config: configWith([
				source(),
			]),
			output: 'overlay',
		});
		const solid = resolveFeatureMatchOverlayRenderModel({
			config: configWith([
				source({ frameCutout: false }),
			]),
			output: 'overlay',
		});

		expect(cutting.sourceCutouts.map(cutout => cutout.id)).toEqual(['s1']);
		expect(solid.sourceCutouts).toEqual([]);
	});

	it('keeps per-side border visibility, which the host layer did not drop', () => {
		const model = resolveFeatureMatchOverlayRenderModel({
			config: configWith([
				source({
					framingStyle: {
						borderVisible: true,
						borderColor: '#ffffff',
						borderWidth: 3,
						borderLeftVisible: false,
					},
				}),
			]),
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
			config: configWith([
				source({ framingStyle }),
			]),
			output: 'overlay',
		});
		const key = resolveFeatureMatchOverlayRenderModel({
			config: configWith([
				source({ framingStyle }),
			]),
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
			filter: 'drop-shadow(0 0 10px #ffffff80)',
		});
		// The Key Output keys the same glow: white at its own opacity, from the
		// same border copy, so a half-opaque glow is grey in the matte.
		expect(key.sourceItems[0]!.glowContainerStyle).toEqual(overlay.sourceItems[0]!.glowContainerStyle);
		expect(key.sourceItems[0]!.glowStyle).toMatchObject({
			borderTop: '4px solid #ffffff',
			filter: 'drop-shadow(0 0 10px #ffffff80)',
		});
	});

	it('glows in the border colour at three-quarter opacity when the glow has neither of its own', () => {
		const framingStyle = {
			borderVisible: true,
			borderColor: '#0077a3',
			borderWidth: 2,
			glowSize: 6,
		};
		const glowFilter = (output: 'fill' | 'key') => resolveFeatureMatchOverlayRenderModel({
			config: configWith([
				source({ framingStyle }),
			]),
			output,
		}).sourceItems[0]!.glowStyle?.filter;

		expect(glowFilter('fill')).toBe('drop-shadow(0 0 6px #0077a3bf)');
		expect(glowFilter('key')).toBe('drop-shadow(0 0 6px #ffffffbf)');
	});

	it('keeps the opacity of a colour that is not hex', () => {
		const model = resolveFeatureMatchOverlayRenderModel({
			config: configWith([
				source({
					framingStyle: {
						backgroundColor: 'rebeccapurple',
						backgroundOpacity: 0.5,
						borderVisible: true,
						glowColor: 'rgb(255, 81, 199)',
						glowSize: 10,
						glowOpacity: 0.25,
					},
				}),
			]),
			output: 'fill',
		});

		expect(model.sourceItems[0]!.style.background).toBe('color-mix(in srgb, rebeccapurple 50%, transparent)');
		expect(model.sourceItems[0]!.glowStyle?.filter)
			.toBe('drop-shadow(0 0 10px color-mix(in srgb, rgb(255, 81, 199) 25%, transparent))');
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
				config: configWith([
					source({
						framingStyle: { ...framingStyle, glowPosition },
					}),
				]),
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
			config: configWith([
				source({
					framingStyle: { backgroundGradient: gradient },
				}),
			]),
			output: 'overlay',
		});
		const overBase = resolveFeatureMatchOverlayRenderModel({
			config: configWith([
				source({
					framingStyle: { backgroundGradient: gradient, backgroundColor: '#001122', backgroundOpacity: 0.5 },
				}),
			]),
			output: 'overlay',
		});
		const key = resolveFeatureMatchOverlayRenderModel({
			config: configWith([
				source({
					framingStyle: { backgroundGradient: gradient },
				}),
			]),
			output: 'key',
		});

		// A gradient alone is fully opaque, as it was before the rewrite.
		expect(model.sourceItems[0]!.style.background).toBe(gradient);
		expect(overBase.sourceItems[0]!.style.background).toBe(`${gradient}, #00112280`);
		// A Key Output is a matte: the gradient becomes coverage, not colour.
		expect(key.sourceItems[0]!.style.background).toBe('#ffffffff');
	});

	it('paints the Key Output in white and the Fill Output over black', () => {
		const key = resolveFeatureMatchOverlayRenderModel({
			config: configWith([
				source({
					framingStyle: { borderVisible: true, borderColor: '#0077a3', borderWidth: 4 },
				}),
			]),
			output: 'key',
		});
		const fill = resolveFeatureMatchOverlayRenderModel({
			config: configWith([]),
			output: 'fill',
		});

		expect(key.sourceItems[0]!.style.borderTop).toBe('4px solid #ffffff');
		expect(key.frame.fill).toBe('#ffffff');
		expect(fill.canvasStyle.background).toBe('#000000');
	});

	it('renders an overlay canvas transparent', () => {
		const model = resolveFeatureMatchOverlayRenderModel({
			config: configWith([]),
			output: 'overlay',
		});

		expect(model.canvasStyle.background).toBe('transparent');
	});

	describe('the Frame', () => {
		const bordered = {
			borderVisible: true,
			borderColor: '#0077a3',
			borderWidth: 4,
			borderLeftVisible: false,
		} satisfies Partial<FeatureMatchOverlayFrameConfig>;

		it('paints its border in its colour, and white in the Key Output, on the enabled sides', () => {
			expect(frameModel('fill', bordered).border).toEqual({
				stroke: '#0077a3',
				strokeWidth: 4,
				sides: ['Top', 'Right', 'Bottom'],
				glow: undefined,
			});
			expect(frameModel('key', bordered).border).toMatchObject({ stroke: '#ffffff', strokeWidth: 4 });
		});

		it('paints a one-pixel border when no width is stored', () => {
			expect(frameModel('fill', { borderVisible: true, borderColor: '#0077a3' }).border?.strokeWidth).toBe(1);
		});

		it('paints no border while it is off or has no colour, in any output', () => {
			for (const output of ['overlay', 'fill', 'key'] as const) {
				expect(frameModel(output, { ...bordered, borderVisible: false }).border).toBeUndefined();
				// The Fill Output paints a colourless border as nothing, so the Key
				// Output must not key a white one.
				expect(frameModel(output, { ...bordered, borderColor: undefined }).border).toBeUndefined();
			}
		});

		it('glows its border at the glow colour and opacity, and white at that opacity in the Key Output', () => {
			const glowing = {
				...bordered,
				glowColor: '#ff51c7',
				glowSize: 12,
				glowOpacity: 0.5,
			};

			expect(frameModel('fill', glowing).border?.glow).toEqual({
				filterId: 'frame-glow',
				stdDeviation: 6,
				floodColor: '#ff51c7',
				floodOpacity: 0.5,
			});
			expect(frameModel('key', glowing).border?.glow).toEqual({
				filterId: 'frame-glow',
				stdDeviation: 6,
				floodColor: '#ffffff',
				floodOpacity: 0.5,
			});
		});

		it('glows in the border colour at three-quarter opacity when the glow has neither of its own', () => {
			expect(frameModel('fill', { ...bordered, glowSize: 8 }).border?.glow)
				.toMatchObject({ floodColor: '#0077a3', floodOpacity: 0.75 });
		});

		it('paints no glow without a size', () => {
			expect(frameModel('key', { ...bordered, glowSize: 0 }).border?.glow).toBeUndefined();
		});

		it('fills white in the Key Output, at the Frame opacity', () => {
			expect(frameModel('fill', {}).fill).toBe('#101820');
			expect(frameModel('key', {}).fill).toBe('#ffffff');
			expect(frameModel('key', {}).opacity).toBe(0.9);
		});

		it('paints its image and raw CSS gradient in colour only, leaving the Key Output to its white fill', () => {
			const gradient = 'linear-gradient(90deg, #b80054, #7f22f6)';

			expect(frameModel('fill', { gradient }).gradientStyle).toEqual({ background: gradient, opacity: 0.9 });
			expect(frameModel('fill', { gradient: '  ' }).gradientStyle).toBeUndefined();
			expect(frameModel('key', { gradient }).gradientStyle).toBeUndefined();
			expect(frameModel('overlay', {}).paintsImage).toBe(true);
			expect(frameModel('key', {}).paintsImage).toBe(false);
		});
	});
});
