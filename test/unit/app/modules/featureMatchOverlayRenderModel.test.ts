import type { FeatureMatchOverlaySurface, FeatureMatchOverlayThemeSurfaces } from '~~/app/modules/feature-match-overlay/renderModel';
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
 * The host-owned render model: the Frame and the Source Items placed against it,
 * painted from the Feature Match Overlay's surface Mode Tokens (#831).
 *
 * Everything else a Feature Match Layout draws is the shared compositor's, and is
 * covered by the shared render-model suite. What is asserted here is what only
 * this host does: an external video source area, the cutout it punches through the
 * Frame, and the Overlay, Fill and Key Output derivations of both.
 */

const OUTPUTS = ['overlay', 'fill', 'key'] as const;

function surface(overrides: Partial<FeatureMatchOverlaySurface> = {}): FeatureMatchOverlaySurface {
	return {
		fill: { type: 'solid', color: '#101820' },
		fillOpacity: 1,
		...overrides,
	};
}

const OUTLINED = surface({
	fill: { type: 'solid', color: '#000000' },
	fillOpacity: 0,
	outline: { color: '#0077a3', width: 4 },
});

function surfaces(overrides: Partial<FeatureMatchOverlayThemeSurfaces> = {}): FeatureMatchOverlayThemeSurfaces {
	return {
		frameSurface: surface(),
		sourceSurface: OUTLINED,
		...overrides,
	};
}

function configWith(sources: FeatureMatchSourceItemConfig[]): FeatureMatchOverlayModeConfig {
	const base = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
	return {
		...base,
		layout: { ...base.layout, sources },
	};
}

function sourceModel(
	output: FeatureMatchOverlayOutput,
	item: FeatureMatchSourceItemConfig,
	sourceSurface: FeatureMatchOverlaySurface = OUTLINED,
) {
	return resolveFeatureMatchOverlayRenderModel({
		config: configWith([item]),
		output,
		surfaces: surfaces({ sourceSurface }),
	});
}

function frameModel(
	output: FeatureMatchOverlayOutput,
	frameSurface: FeatureMatchOverlaySurface,
	{ frame = {}, paintsMedia = false }: { frame?: Partial<FeatureMatchOverlayFrameConfig>; paintsMedia?: boolean } = {},
) {
	const base = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
	return resolveFeatureMatchOverlayRenderModel({
		config: {
			...base,
			layout: {
				...base.layout,
				frame: { opacity: 0.9, ...frame },
			},
		},
		output,
		surfaces: surfaces({ frameSurface }),
		paintsMedia,
		maskId: 'frame-mask',
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
		const model = sourceModel('overlay', source());

		expect(model.sourceItems).toHaveLength(1);
		expect(model.sourceItems[0]!.style).toMatchObject({
			left: '100px',
			top: '50px',
			width: '400px',
			height: '200px',
		});
	});

	it('omits a hidden Source Item and its cutout', () => {
		const model = sourceModel('overlay', source({ visible: false }));

		expect(model.sourceItems).toEqual([]);
		expect(model.sourceCutouts).toEqual([]);
	});

	it('cuts a Source Item through the Frame only when it asks to, inside its border', () => {
		const cutting = sourceModel('overlay', source());
		const solid = sourceModel('overlay', source({ frameCutout: false }));
		const borderless = sourceModel('overlay', source(), surface({ fillOpacity: 0 }));

		expect(cutting.sourceCutouts).toEqual([
			{
				id: 's1',
				path: expect.stringMatching(/^M 104 54 /),
			},
		]);
		expect(borderless.sourceCutouts).toEqual([
			{
				id: 's1',
				path: expect.stringMatching(/^M 100 50 /),
			},
		]);
		expect(solid.sourceCutouts).toEqual([]);
	});

	describe('a Source Item', () => {
		it.each([
			{ output: 'fill', border: '4px solid #0077a3' },
			{ output: 'key', border: '4px solid #ffffff' },
		] as const)('borders its enabled sides with its surface\'s outline in the $output Output', ({ output, border }) => {
			const style = sourceModel(output, source({
				framingStyle: { borderLeftVisible: false },
			})).sourceItems[0]!.style;

			expect(style).toMatchObject({ borderTop: border, borderRight: border, borderLeft: 'none' });
		});

		it('paints no border when its surface has no outline', () => {
			expect(sourceModel('fill', source(), surface()).sourceItems[0]!.style.borderTop).toBe('none');
		});

		it.each([
			{
				output: 'fill',
				fill: { type: 'solid', color: '#001122' },
				fillOpacity: 0.5,
				background: '#00112280',
			},
			{
				output: 'key',
				fill: { type: 'solid', color: '#001122' },
				fillOpacity: 0.5,
				background: '#ffffff80',
			},
			// A translucent colour keys at its own alpha (#829).
			{
				output: 'key',
				fill: { type: 'solid', color: 'rgba(0, 17, 34, 0.5)' },
				fillOpacity: 1,
				background: '#ffffff80',
			},
			{
				output: 'fill',
				fill: { type: 'solid', color: '#001122' },
				fillOpacity: 0,
				background: 'transparent',
			},
			{
				output: 'fill',
				fill: {
					type: 'linear-gradient',
					angle: 90,
					stops: [
						{ color: '#b80054', position: 0, opacity: 1 },
						{ color: '#7f22f6', position: 1, opacity: 0.5 },
					],
				},
				fillOpacity: 1,
				background: 'linear-gradient(90deg, #b80054 0%, #7f22f680 100%)',
			},
			{
				output: 'key',
				fill: {
					type: 'linear-gradient',
					angle: 90,
					stops: [
						{ color: '#b80054', position: 0, opacity: 1 },
						{ color: '#7f22f6', position: 1, opacity: 0.5 },
					],
				},
				fillOpacity: 1,
				background: 'linear-gradient(90deg, #ffffffff 0%, #ffffff80 100%)',
			},
		] as const)('fills with its surface: $background in the $output Output', ({ output, fill, fillOpacity, background }) => {
			const style = sourceModel(output, source(), surface({ fill: fill as unknown as FeatureMatchOverlaySurface['fill'], fillOpacity })).sourceItems[0]!.style;

			expect(style.background).toBe(background);
		});

		it('glows its rounded border with its surface\'s glow, white at the glow\'s opacity in the Key Output', () => {
			const glowing = {
				...OUTLINED,
				glow: { color: '#ffffff', size: 10, opacity: 0.5 },
			};
			const item = source({
				framingStyle: {
					borderRadius: 8,
					borderRadiusTopLeft: 12,
					borderRadiusTopRight: 4,
					borderRadiusBottomLeft: 6,
				},
			});
			const overlay = sourceModel('overlay', item, glowing).sourceItems[0]!;
			const key = sourceModel('key', item, glowing).sourceItems[0]!;

			expect(overlay.style).not.toHaveProperty('boxShadow');
			expect(overlay.glowContainerStyle).toMatchObject({
				left: '70px',
				top: '20px',
				width: '460px',
				height: '260px',
				overflow: 'hidden',
			});
			expect(overlay.glowContainerStyle).not.toHaveProperty('maskImage');
			expect(overlay.glowStyle).toMatchObject({
				borderRadius: '12px 4px 8px 6px',
				borderTop: '4px solid #0077a3',
				filter: 'drop-shadow(0 0 10px #ffffff80)',
			});
			expect(key.glowContainerStyle).toEqual(overlay.glowContainerStyle);
			expect(key.glowStyle).toMatchObject({
				borderTop: '4px solid #ffffff',
				filter: 'drop-shadow(0 0 10px #ffffff80)',
			});
		});

		it('has no glow without an outline to glow', () => {
			const glowOnly = surface({
				glow: { color: '#ffffff', size: 10, opacity: 1 },
			});

			expect(sourceModel('fill', source(), glowOnly).sourceItems[0]!.glowStyle).toBeUndefined();
		});

		it('masks its glow to only the selected side of its rounded border', () => {
			const glowing = {
				...OUTLINED,
				outline: { color: '#ffffff', width: 2 },
				glow: { color: '#ffffff', size: 10, opacity: 1 },
			};
			const maskFor = (glowPosition: 'inside' | 'outside') => decodeURIComponent(String(
				sourceModel('overlay', source({
					framingStyle: { borderRadius: 8, glowPosition },
				}), glowing).sourceItems[0]!.glowContainerStyle!.maskImage,
			));

			expect(maskFor('inside')).toContain('<path d="M 38 30');
			expect(maskFor('inside')).not.toContain('M 0 0 H 460 V 260');
			expect(maskFor('outside')).toContain('<path d="M 0 0 H 460 V 260 H 0 Z M 38 30');
			expect(maskFor('outside')).toContain('fill-rule="evenodd"');
		});
	});

	describe('the Frame', () => {
		const outlined = surface({
			outline: { color: '#0077a3', width: 4 },
		});

		it('borders its enabled canvas edges with its surface\'s outline, white in the Key Output', () => {
			const frame = { borderLeftVisible: false };

			expect(frameModel('fill', outlined, { frame }).border).toEqual({
				stroke: '#0077a3',
				strokeWidth: 4,
				sides: ['Top', 'Right', 'Bottom'],
				glow: undefined,
			});
			expect(frameModel('key', outlined, { frame }).border).toMatchObject({ stroke: '#ffffff', strokeWidth: 4 });
		});

		it.each(OUTPUTS)('paints no border without an outline, in the %s Output', (output) => {
			expect(frameModel(output, surface()).border).toBeUndefined();
			expect(frameModel(output, surface({
				outline: { color: '#0077a3', width: 0 },
			})).border).toBeUndefined();
		});

		it.each([
			{ output: 'fill', floodColor: '#ff51c7' },
			{ output: 'key', floodColor: '#ffffff' },
		] as const)('glows its border with its surface\'s glow in the $output Output', ({ output, floodColor }) => {
			const glowing = {
				...outlined,
				glow: { color: '#ff51c7', size: 12, opacity: 0.5 },
			};

			expect(frameModel(output, glowing).border?.glow).toEqual({
				filterId: 'frame-glow',
				stdDeviation: 6,
				floodColor,
				floodOpacity: 0.5,
			});
		});

		it.each([
			{
				output: 'fill',
				fill: { color: '#101820', opacity: 0.8 },
			},
			{
				output: 'key',
				fill: { color: '#ffffff', opacity: 0.8 },
			},
		] as const)('fills with its surface at its fill opacity in the $output Output, under the Frame\'s own opacity', ({ output, fill }) => {
			const model = frameModel(output, surface({ fillOpacity: 0.8 }));

			expect(model.fill).toEqual(fill);
			expect(model.opacity).toBe(0.9);
		});

		it('keys a translucent fill at its own alpha, and a clear one not at all', () => {
			expect(frameModel('key', surface({
				fill: { type: 'solid', color: 'rgba(16, 24, 32, 0.5)' },
			})).fill.color).toBe('#ffffff80');
			expect(frameModel('key', surface({
				fill: { type: 'solid', color: 'rgba(0, 0, 0, 0)' },
			})).fill.color).toBe('#ffffff00');
		});

		it('keys the Frame through an opaque white fill while it paints media the Key Output has no colour of', () => {
			const clear = surface({
				fill: { type: 'solid', color: 'rgba(0, 0, 0, 0)' },
			});

			expect(frameModel('key', clear, { paintsMedia: true }).fill).toEqual({ color: '#ffffff', opacity: 1 });
			expect(frameModel('fill', clear, { paintsMedia: true }).fill.color).toBe('rgba(0, 0, 0, 0)');
		});

		it('fills with a gradient its SVG defines, white at each stop\'s opacity in the Key Output', () => {
			const gradient = surface({
				fill: {
					type: 'linear-gradient',
					angle: 180,
					stops: [
						{ color: '#b80054', position: 0, opacity: 1 },
						{ color: '#7f22f6', position: 1, opacity: 0.5 },
					],
				},
			});

			expect(frameModel('fill', gradient).fill).toMatchObject({
				color: 'url(#graphic-fill-frame-mask)',
				gradient: {
					stops: [
						{ color: '#b80054', opacity: 1 },
						{ color: '#7f22f6', opacity: 0.5 },
					],
				},
			});
			expect(frameModel('key', gradient).fill.gradient?.stops.map(stop => [stop.color, stop.opacity])).toEqual([
				['#ffffff', 1],
				['#ffffff', 0.5],
			]);
		});

		it('paints its image in colour only, leaving the Key Output to its fill', () => {
			expect(frameModel('overlay', surface()).paintsImage).toBe(true);
			expect(frameModel('key', surface()).paintsImage).toBe(false);
		});
	});
});
