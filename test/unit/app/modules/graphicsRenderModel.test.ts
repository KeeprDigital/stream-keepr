import type {
	BroadcastGraphicConfig,
	GraphicGroupChildConfig,
	GraphicGroupItemConfig,
	GraphicSurfaceStyle,
	ShapeGraphicItemConfig,
	TextGraphicItemConfig,
} from '~~/shared/types/graphics';
import type { GraphicItemRenderDescriptor } from '~/modules/graphics/renderModel';
import { describe, expect, it } from 'vitest';
import { DEFAULT_GRAPHIC_TYPOGRAPHY, squareShapeGeometry } from '~~/shared/modules/graphics';
import { resolveGraphicsCompositionRenderModel } from '~/modules/graphics/renderModel';

function surfaceStyle(overrides: Partial<GraphicSurfaceStyle> = {}): GraphicSurfaceStyle {
	return { fill: { type: 'solid', color: '#0077a3' }, fillOpacity: 0.5, ...overrides };
}

function shape(id: string, overrides: Partial<ShapeGraphicItemConfig> = {}): ShapeGraphicItemConfig {
	return {
		type: 'shape',
		id,
		label: id,
		visible: true,
		anchor: 'top-left',
		x: 10,
		y: 20,
		width: 300,
		height: 100,
		geometry: squareShapeGeometry(),
		surfaceStyle: surfaceStyle(),
		...overrides,
	};
}

function text(id: string, overrides: Partial<TextGraphicItemConfig> = {}): TextGraphicItemConfig {
	return {
		type: 'text',
		id,
		label: id,
		visible: true,
		anchor: 'top-left',
		x: 0,
		y: 0,
		width: 400,
		height: 80,
		text: 'Commentator',
		typography: { ...DEFAULT_GRAPHIC_TYPOGRAPHY },
		overflowPolicy: 'ellipsis',
		minFontSize: 24,
		...overrides,
	};
}

function group(
	id: string,
	children: GraphicGroupChildConfig[],
	overrides: Partial<GraphicGroupItemConfig> = {},
): GraphicGroupItemConfig {
	return {
		type: 'group',
		id,
		label: id,
		visible: true,
		anchor: 'top-left',
		x: 100,
		y: 200,
		width: 600,
		height: 120,
		arrangement: 'row',
		padding: 0,
		gap: 16,
		align: 'stretch',
		justify: 'start',
		clip: false,
		geometry: squareShapeGeometry(),
		children,
		...overrides,
	};
}

function graphic(id: string, items: BroadcastGraphicConfig['items']): BroadcastGraphicConfig {
	return { id, name: id, items };
}

/**
 * Stand-in for the browser's compositor: plain source-over of each painted
 * colour onto the backdrop, `C_out = C_src * a_src + C_dst * (1 - a_src)`,
 * written from the compositing rule rather than from this module. Returns the
 * resulting luminance, which for a Key Output is the composed alpha.
 *
 * Deliberately strict: a fill that is not pure white, or a backdrop that is not
 * black, produces a luminance that no longer equals the alpha union — which is
 * exactly the regression this guards against.
 */
function compositeKeyLuminance(backdrop: unknown, paints: KeyPaint[]): number {
	const base = keyChannels(String(backdrop ?? ''));
	return paints.reduce<number>((destination, paint) => {
		const source = keyChannels(paint.color);
		const alpha = source.alpha * paint.opacity;
		return (source.luminance * alpha) + (destination * (1 - alpha));
	}, base.luminance * base.alpha);
}

function keyChannels(value: string): { luminance: number; alpha: number } {
	const hex = /^#([\da-f]{6})([\da-f]{2})?$/i.exec(value.trim());
	if (!hex)
		throw new Error(`Key Output painted a colour this compositor cannot read: ${value}`);
	const rgb = hex[1]!;
	const red = Number.parseInt(rgb.slice(0, 2), 16) / 255;
	const green = Number.parseInt(rgb.slice(2, 4), 16) / 255;
	const blue = Number.parseInt(rgb.slice(4, 6), 16) / 255;
	if (red !== green || green !== blue)
		throw new Error(`Key Output must paint greyscale, got #${rgb}`);
	return {
		luminance: red,
		alpha: hex[2] === undefined ? 1 : Number.parseInt(hex[2], 16) / 255,
	};
}

interface KeyPaint {
	color: string;
	opacity: number;
}

/**
 * Every colour one Graphic Item paints, in paint order. Walking the descriptor
 * rather than naming fields keeps the matte guard honest as the vocabulary
 * grows: a new painted colour has to appear here to stay unnoticed.
 */
function itemPaints(item: GraphicItemRenderDescriptor): KeyPaint[] {
	const paints: KeyPaint[] = [];
	const glow = /drop-shadow\([^)]*?(#[\da-f]{6,8}|color-mix\([^)]*\))\)/i.exec(String(item.style.filter ?? ''));
	if (glow)
		paints.push({ color: glow[1]!, opacity: 1 });

	const surface = item.surface;
	if (surface) {
		const gradient = surface.fill.gradient;
		if (gradient) {
			for (const stop of gradient.stops)
				paints.push({ color: stop.color, opacity: stop.opacity * surface.fill.opacity });
		}
		else {
			paints.push({ color: surface.fill.color, opacity: surface.fill.opacity });
		}
		if (surface.outline)
			paints.push({ color: surface.outline.color, opacity: 1 });
	}

	if (item.textStyle?.color)
		paints.push({ color: String(item.textStyle.color), opacity: 1 });

	return [...paints, ...(item.children ?? []).flatMap(itemPaints)];
}

const CANVAS = { canvasWidth: 1920, canvasHeight: 1080 };

describe('graphicsCompositionRenderModel', () => {
	it('renders an empty composition transparent in the Overlay Output and black in Fill and Key', () => {
		for (const [output, background] of [['overlay', 'transparent'], ['fill', '#000000'], ['key', '#000000']] as const) {
			const model = resolveGraphicsCompositionRenderModel({ output, graphics: [], ...CANVAS });

			expect(model.graphics).toEqual([]);
			expect(model.canvasStyle.background).toBe(background);
		}
	});

	it('composites concurrent Broadcast Graphics in authored Screen stack order regardless of selection order', () => {
		const graphics = [graphic('back', [shape('a')]), graphic('middle', [shape('b')]), graphic('front', [shape('c')])];

		const model = resolveGraphicsCompositionRenderModel({
			output: 'overlay',
			graphics,
			visibleGraphicIds: ['front', 'back'],
			...CANVAS,
		});

		expect(model.graphics.map(entry => entry.id)).toEqual(['back', 'front']);
	});

	it('composites every Broadcast Graphic when no visible set is supplied', () => {
		const model = resolveGraphicsCompositionRenderModel({
			output: 'overlay',
			graphics: [graphic('a', []), graphic('b', [])],
			...CANVAS,
		});

		expect(model.graphics.map(entry => entry.id)).toEqual(['a', 'b']);
	});

	it('omits a hidden Graphic Item, and a hidden Graphic Group child, from the composed frame', () => {
		const model = resolveGraphicsCompositionRenderModel({
			output: 'overlay',
			graphics: [graphic('a', [
				shape('shown'),
				shape('hidden', { visible: false }),
				group('cluster', [shape('child-shown'), shape('child-hidden', { visible: false })]),
			])],
			...CANVAS,
		});

		expect(model.graphics[0]?.items.map(item => item.id)).toEqual(['shown', 'cluster']);
		expect(model.graphics[0]?.items[1]?.children?.map(child => child.id)).toEqual(['child-shown']);
	});

	it('positions a Graphic Item from its stored top-left rectangle whatever its Graphic Anchor Point', () => {
		const model = resolveGraphicsCompositionRenderModel({
			output: 'overlay',
			graphics: [graphic('a', [shape('corner'), shape('centred', { anchor: 'center' })])],
			...CANVAS,
		});

		for (const item of model.graphics[0]!.items) {
			expect(item.style.left).toBe('10px');
			expect(item.style.top).toBe('20px');
			expect(item.style.width).toBe('300px');
			expect(item.style.height).toBe('100px');
		}
	});

	it('paints a Shape Graphic Item as its Shape Geometry path with its authored fill opacity', () => {
		const model = resolveGraphicsCompositionRenderModel({
			output: 'overlay',
			graphics: [graphic('a', [shape('bar', {
				geometry: { ...squareShapeGeometry(), topRight: { treatment: 'cut', size: 24 }, rightSlant: 40 },
			})])],
			...CANVAS,
		});

		expect(model.graphics[0]?.items[0]?.surface).toMatchObject({
			width: 300,
			height: 100,
			// The cut walks 24 along each edge it meets, and the right edge is slanted.
			path: 'M 0 0 L 236 0 L 268.91 22.28 L 300 100 L 0 100 Z',
			fill: { color: '#0077a3', opacity: 0.5 },
		});
	});

	it('paints a linear-gradient Graphic Fill as a gradient projected on the surface', () => {
		const model = resolveGraphicsCompositionRenderModel({
			output: 'overlay',
			graphics: [graphic('a', [shape('bed', {
				surfaceStyle: surfaceStyle({
					fillOpacity: 1,
					fill: {
						type: 'linear-gradient',
						angle: 90,
						stops: [
							{ color: '#080d12', position: 0, opacity: 0.97 },
							{ color: '#1c272d', position: 1, opacity: 0.9 },
						],
					},
				}),
			})])],
			...CANVAS,
		});

		const fill = model.graphics[0]?.items[0]?.surface?.fill;
		expect(fill?.color).toBe('url(#graphic-fill-bed)');
		// Ninety degrees points right, so the axis runs across the surface.
		expect(fill?.gradient).toMatchObject({
			id: 'graphic-fill-bed',
			x1: '0',
			y1: '0.5',
			x2: '1',
			y2: '0.5',
			stops: [
				{ offset: '0%', color: '#080d12', opacity: 0.97 },
				{ offset: '100%', color: '#1c272d', opacity: 0.9 },
			],
		});
	});

	it('draws a uniform outline as an inner stroke of the same Shape Geometry path', () => {
		const model = resolveGraphicsCompositionRenderModel({
			output: 'overlay',
			graphics: [graphic('a', [shape('bar', {
				surfaceStyle: surfaceStyle({ outline: { color: '#00d9ff', width: 3 } }),
			})])],
			...CANVAS,
		});

		const surface = model.graphics[0]?.items[0]?.surface;
		expect(surface?.outline).toEqual({ color: '#00d9ff', width: 3, clipId: 'graphic-outline-bar' });
		expect(surface?.path).toBe(model.graphics[0]?.items[0]?.surface?.path);
	});

	it('omits an outline of zero width rather than painting a hairline', () => {
		const model = resolveGraphicsCompositionRenderModel({
			output: 'overlay',
			graphics: [graphic('a', [shape('bar', {
				surfaceStyle: surfaceStyle({ outline: { color: '#00d9ff', width: 0 } }),
			})])],
			...CANVAS,
		});

		expect(model.graphics[0]?.items[0]?.surface?.outline).toBeUndefined();
	});

	it('renders a glow as a drop-shadow of the item at its authored colour and opacity', () => {
		const model = resolveGraphicsCompositionRenderModel({
			output: 'overlay',
			graphics: [graphic('a', [
				shape('lit', { surfaceStyle: surfaceStyle({ glow: { color: '#00d9ff', size: 24, opacity: 0.5 } }) }),
				shape('unlit'),
				shape('off', { surfaceStyle: surfaceStyle({ glow: { color: '#00d9ff', size: 0, opacity: 1 } }) }),
			])],
			...CANVAS,
		});

		const [lit, unlit, off] = model.graphics[0]!.items;
		expect(lit?.style.filter).toBe('drop-shadow(0 0 24px #00d9ff80)');
		expect(unlit?.style.filter).toBeUndefined();
		expect(off?.style.filter).toBeUndefined();
	});

	it('gives a Text Graphic Item its own Graphic Surface Style behind its text', () => {
		const model = resolveGraphicsCompositionRenderModel({
			output: 'overlay',
			graphics: [graphic('a', [
				text('plain'),
				text('badge', { surfaceStyle: surfaceStyle({ fillOpacity: 1 }) }),
			])],
			...CANVAS,
		});

		const [plain, badge] = model.graphics[0]!.items;
		expect(plain?.surface).toBeUndefined();
		expect(badge?.surface).toMatchObject({ fill: { color: '#0077a3', opacity: 1 } });
		// Typography owns text colour; the surface is the box behind it.
		expect(badge?.textStyle?.color).toBe(DEFAULT_GRAPHIC_TYPOGRAPHY.color);
	});

	it('rotates a canvas-positioned Graphic Item around its Graphic Anchor Point', () => {
		const model = resolveGraphicsCompositionRenderModel({
			output: 'overlay',
			graphics: [graphic('a', [
				shape('tilted', { rotation: -6, anchor: 'bottom-left' }),
				shape('straight', { rotation: 0 }),
			])],
			...CANVAS,
		});

		expect(model.graphics[0]?.items[0]?.style).toMatchObject({
			transform: 'rotate(-6deg)',
			transformOrigin: '0% 100%',
		});
		expect(model.graphics[0]?.items[1]?.style.transform).toBeUndefined();
	});

	it('never rotates a row or column Graphic Group child, which its group positions', () => {
		const model = resolveGraphicsCompositionRenderModel({
			output: 'overlay',
			graphics: [graphic('a', [group('row', [shape('child', { rotation: 30 })])])],
			...CANVAS,
		});

		expect(model.graphics[0]?.items[0]?.children?.[0]?.style.transform).toBeUndefined();
	});

	describe('graphic groups', () => {
		it('arranges direct children as a row, a column, or a canvas', () => {
			for (const [arrangement, flexDirection] of [['row', 'row'], ['column', 'column']] as const) {
				const model = resolveGraphicsCompositionRenderModel({
					output: 'overlay',
					graphics: [graphic('a', [group('cluster', [shape('one')], { arrangement, gap: 12, padding: 8 })])],
					...CANVAS,
				});

				expect(model.graphics[0]?.items[0]?.style).toMatchObject({
					display: 'flex',
					flexDirection,
					gap: '12px',
					padding: '8px',
				});
			}

			const canvas = resolveGraphicsCompositionRenderModel({
				output: 'overlay',
				graphics: [graphic('a', [group('cluster', [shape('one')], { arrangement: 'canvas' })])],
				...CANVAS,
			});

			expect(canvas.graphics[0]?.items[0]?.style.display).toBeUndefined();
		});

		it('sizes a row child by fixed pixels or by weighted fill', () => {
			const model = resolveGraphicsCompositionRenderModel({
				output: 'overlay',
				graphics: [graphic('a', [group('cluster', [
					shape('fixed', { sizing: { mode: 'fixed', size: 220, weight: 1 } }),
					shape('filling', { sizing: { mode: 'fill', size: 0, weight: 3 } }),
					shape('default'),
				])])],
				...CANVAS,
			});

			const children = model.graphics[0]!.items[0]!.children!;
			expect(children[0]?.style.flex).toBe('0 0 220px');
			expect(children[1]?.style.flex).toBe('3 1 0');
			// Without authored sizing, a child holds its own main-axis extent.
			expect(children[2]?.style.flex).toBe('0 0 300px');
		});

		it('applies its own alignment and justification to stacked children', () => {
			const model = resolveGraphicsCompositionRenderModel({
				output: 'overlay',
				graphics: [graphic('a', [group('cluster', [shape('one')], {
					align: 'center',
					justify: 'space-between',
				})])],
				...CANVAS,
			});

			expect(model.graphics[0]?.items[0]?.style).toMatchObject({
				alignItems: 'center',
				justifyContent: 'space-between',
			});
			// Not stretching, so the child keeps its own cross-axis extent.
			expect(model.graphics[0]?.items[0]?.children?.[0]?.style).toMatchObject({
				alignSelf: 'center',
				height: '100px',
			});
		});

		it('places a canvas child absolutely inside its group, offset by the group padding', () => {
			const model = resolveGraphicsCompositionRenderModel({
				output: 'overlay',
				graphics: [graphic('a', [group('cluster', [shape('badge', { x: 24, y: 8 })], {
					arrangement: 'canvas',
					padding: 10,
				})])],
				...CANVAS,
			});

			expect(model.graphics[0]?.items[0]?.children?.[0]?.style).toMatchObject({
				position: 'absolute',
				left: '34px',
				top: '18px',
			});
		});

		it('clips children to its own Shape Geometry only when asked', () => {
			const clipped = resolveGraphicsCompositionRenderModel({
				output: 'overlay',
				graphics: [graphic('a', [group('cluster', [], {
					clip: true,
					geometry: { ...squareShapeGeometry(), rightSlant: 60 },
				})])],
				...CANVAS,
			});
			const rectangular = resolveGraphicsCompositionRenderModel({
				output: 'overlay',
				graphics: [graphic('a', [group('cluster', [], { clip: true })])],
				...CANVAS,
			});
			const open = resolveGraphicsCompositionRenderModel({
				output: 'overlay',
				graphics: [graphic('a', [group('cluster', [])])],
				...CANVAS,
			});

			expect(clipped.graphics[0]?.items[0]?.style.clipPath)
				.toBe(`path('M 0 0 L 540 0 L 600 120 L 0 120 Z')`);
			// A plain rectangle needs no path to clip to.
			expect(rectangular.graphics[0]?.items[0]?.style).toMatchObject({ overflow: 'hidden' });
			expect(rectangular.graphics[0]?.items[0]?.style.clipPath).toBeUndefined();
			expect(open.graphics[0]?.items[0]?.style.clipPath).toBeUndefined();
			expect(open.graphics[0]?.items[0]?.style.overflow).toBeUndefined();
		});

		it('lends its local style default to children that have none of their own', () => {
			const model = resolveGraphicsCompositionRenderModel({
				output: 'overlay',
				graphics: [graphic('a', [group('cluster', [
					shape('inherits', { surfaceStyle: undefined }),
					shape('overrides', { surfaceStyle: surfaceStyle({ fill: { type: 'solid', color: '#ff0000' }, fillOpacity: 1 }) }),
				], {
					defaultChildSurfaceStyle: { fill: { type: 'solid', color: '#00ff00' }, fillOpacity: 0.25 },
				})])],
				...CANVAS,
			});

			const children = model.graphics[0]!.items[0]!.children!;
			expect(children[0]?.surface?.fill).toMatchObject({ color: '#00ff00', opacity: 0.25 });
			expect(children[1]?.surface?.fill).toMatchObject({ color: '#ff0000', opacity: 1 });
		});

		it('paints no surface for a child with no style of its own and no group default', () => {
			const model = resolveGraphicsCompositionRenderModel({
				output: 'overlay',
				graphics: [graphic('a', [group('cluster', [shape('bare', { surfaceStyle: undefined })])])],
				...CANVAS,
			});

			expect(model.graphics[0]?.items[0]?.children?.[0]?.surface).toBeUndefined();
		});

		it('forms one layer among its siblings, with its children inside it', () => {
			const model = resolveGraphicsCompositionRenderModel({
				output: 'overlay',
				graphics: [graphic('a', [
					shape('behind'),
					group('cluster', [text('name'), shape('rule')]),
					shape('in-front'),
				])],
				...CANVAS,
			});

			expect(model.graphics[0]?.items.map(item => item.id)).toEqual(['behind', 'cluster', 'in-front']);
			expect(model.graphics[0]?.items[1]?.children?.map(child => child.id)).toEqual(['name', 'rule']);
			expect(model.graphics[0]?.items[1]?.kind).toBe('group');
		});
	});

	describe('key output', () => {
		it('derives the Key Output as a grayscale alpha matte of the composed opacity', () => {
			const model = resolveGraphicsCompositionRenderModel({
				output: 'key',
				graphics: [graphic('a', [shape('bar'), text('name')])],
				...CANVAS,
			});

			expect(model.graphics[0]?.items[0]?.surface?.fill).toMatchObject({ color: '#ffffff', opacity: 0.5 });
			expect(model.graphics[0]?.items[1]?.textStyle?.color).toBe('#ffffff');
		});

		it('accumulates overlapping Graphic Items into their true combined alpha in the Key Output', () => {
			// Two half-opaque items over the same bounds. Their true combined alpha is
			// the alpha union 1 - (1 - a1)(1 - a2) = 0.75, independent of this module.
			const model = resolveGraphicsCompositionRenderModel({
				output: 'key',
				graphics: [graphic('a', [
					shape('under', { surfaceStyle: surfaceStyle({ fill: { type: 'solid', color: '#0077a3' }, fillOpacity: 0.5 }) }),
					shape('over', { surfaceStyle: surfaceStyle({ fill: { type: 'solid', color: '#ff0000' }, fillOpacity: 0.5 }) }),
				])],
				...CANVAS,
			});

			const luminance = compositeKeyLuminance(
				model.canvasStyle.background,
				model.graphics[0]!.items.flatMap(itemPaints),
			);

			// 8-bit alpha quantisation puts 0.5 at 128/255, so compare to 2 decimals.
			expect(luminance).toBeCloseTo(0.75, 2);
		});

		it('holds the Key Output matte for a stack of many overlapping Graphic Items', () => {
			const alphas = [0.25, 0.5, 0.75, 0.5];
			const model = resolveGraphicsCompositionRenderModel({
				output: 'key',
				graphics: [graphic('a', alphas.map((fillOpacity, index) =>
					shape(`item-${index}`, { surfaceStyle: surfaceStyle({ fill: { type: 'solid', color: '#123456' }, fillOpacity }) }),
				))],
				...CANVAS,
			});

			const expectedUnion = 1 - alphas.reduce((remaining, alpha) => remaining * (1 - alpha), 1);
			const luminance = compositeKeyLuminance(
				model.canvasStyle.background,
				model.graphics[0]!.items.flatMap(itemPaints),
			);

			expect(luminance).toBeCloseTo(expectedUnion, 2);
		});

		it('paints a gradient in the Key Output as white at each stop opacity', () => {
			const model = resolveGraphicsCompositionRenderModel({
				output: 'key',
				graphics: [graphic('a', [shape('bed', {
					surfaceStyle: surfaceStyle({
						fillOpacity: 1,
						fill: {
							type: 'linear-gradient',
							angle: 45,
							stops: [
								{ color: '#ff0000', position: 0, opacity: 0.25 },
								{ color: '#00ff00', position: 1, opacity: 1 },
							],
						},
					}),
				})])],
				...CANVAS,
			});

			expect(model.graphics[0]?.items[0]?.surface?.fill.gradient?.stops).toEqual([
				{ offset: '0%', color: '#ffffff', opacity: 0.25 },
				{ offset: '100%', color: '#ffffff', opacity: 1 },
			]);
		});

		it('resolves an outline and a glow to white in the Key Output', () => {
			const authored = surfaceStyle({
				fillOpacity: 1,
				outline: { color: '#00d9ff', width: 4 },
				glow: { color: '#ff51c7', size: 20, opacity: 0.5 },
			});

			const overlay = resolveGraphicsCompositionRenderModel({
				output: 'overlay',
				graphics: [graphic('a', [shape('bar', { surfaceStyle: authored })])],
				...CANVAS,
			});
			const key = resolveGraphicsCompositionRenderModel({
				output: 'key',
				graphics: [graphic('a', [shape('bar', { surfaceStyle: authored })])],
				...CANVAS,
			});

			expect(overlay.graphics[0]?.items[0]?.surface?.outline?.color).toBe('#00d9ff');
			expect(overlay.graphics[0]?.items[0]?.style.filter).toContain('#ff51c780');
			expect(key.graphics[0]?.items[0]?.surface?.outline?.color).toBe('#ffffff');
			expect(key.graphics[0]?.items[0]?.style.filter).toBe('drop-shadow(0 0 20px #ffffff80)');
		});

		it('paints nothing but greyscale in the Key Output across the whole vocabulary', () => {
			// Hostile by design: every colour any part of the vocabulary paints has to
			// resolve to white, or the Key Output stops being an alpha matte.
			const loud = surfaceStyle({
				fill: {
					type: 'linear-gradient',
					angle: 200,
					stops: [
						{ color: '#ff0000', position: 0, opacity: 1 },
						{ color: '#00ff00', position: 0.5, opacity: 0.5 },
						{ color: '#0000ff', position: 1, opacity: 0.2 },
					],
				},
				outline: { color: '#ff51c7', width: 6 },
				glow: { color: '#5c26ff', size: 30, opacity: 0.9 },
			});

			const model = resolveGraphicsCompositionRenderModel({
				output: 'key',
				graphics: [graphic('a', [
					shape('bed', { surfaceStyle: loud }),
					text('name', {
						surfaceStyle: loud,
						typography: { ...DEFAULT_GRAPHIC_TYPOGRAPHY, color: '#bd167f' },
					}),
					group('cluster', [
						shape('child', { surfaceStyle: loud }),
						text('child-name', { typography: { ...DEFAULT_GRAPHIC_TYPOGRAPHY, color: '#321048' } }),
					], { surfaceStyle: loud, defaultChildSurfaceStyle: loud }),
				])],
				...CANVAS,
			});

			const paints = model.graphics[0]!.items.flatMap(itemPaints);
			expect(paints.length).toBeGreaterThan(10);
			for (const paint of paints)
				expect(keyChannels(paint.color).luminance).toBe(1);
		});
	});

	it('clips every Text Overflow Policy inside the authored bounds', () => {
		const model = resolveGraphicsCompositionRenderModel({
			output: 'overlay',
			graphics: [graphic('a', [
				text('clip', { overflowPolicy: 'clip' }),
				text('ellipsis', { overflowPolicy: 'ellipsis' }),
				text('shrink', { overflowPolicy: 'shrink', minFontSize: 30 }),
			])],
			...CANVAS,
		});

		const [clip, ellipsis, shrink] = model.graphics[0]!.items;
		for (const item of [clip, ellipsis, shrink])
			expect(item?.style.overflow).toBe('hidden');

		expect(clip?.textStyle?.textOverflow).toBe('clip');
		expect(clip?.textStyle?.WebkitLineClamp).toBeUndefined();
		expect(ellipsis?.textStyle?.textOverflow).toBe('ellipsis');
		expect(shrink?.textStyle?.textOverflow).toBe('ellipsis');
		expect(shrink?.shrink).toEqual({ minFontSize: 30, maxFontSize: DEFAULT_GRAPHIC_TYPOGRAPHY.fontSize });
		expect(clip?.shrink).toBeUndefined();
	});

	it('clamps ellipsis text to the whole lines that fit the authored height', () => {
		const model = resolveGraphicsCompositionRenderModel({
			output: 'overlay',
			graphics: [graphic('a', [
				text('one-line', { height: 80 }),
				text('two-lines', { height: 160 }),
			])],
			...CANVAS,
		});

		// 64px at a 1.15 line height is a 73.6px line box.
		expect(model.graphics[0]?.items[0]?.textStyle?.WebkitLineClamp).toBe(1);
		expect(model.graphics[0]?.items[1]?.textStyle?.WebkitLineClamp).toBe(2);
	});

	it('resolves one identical composition for the editor preview and a Screen Output', () => {
		// The editor preview asks for guides; a Screen Output never does. Nothing
		// else may differ, or the two would not render the same frame.
		const graphics = [graphic('a', [
			shape('bed', { surfaceStyle: surfaceStyle({ outline: { color: '#fff', width: 2 } }) }),
			group('cluster', [text('name'), shape('rule', { sizing: { mode: 'fill', size: 0, weight: 2 } })]),
		])];

		const output = resolveGraphicsCompositionRenderModel({ output: 'overlay', graphics, ...CANVAS });
		const preview = resolveGraphicsCompositionRenderModel({
			output: 'overlay',
			graphics,
			itemGuides: true,
			safeAreaGuides: true,
			selectedTarget: { type: 'item', graphicId: 'a', itemId: 'bed' },
			...CANVAS,
		});

		expect(preview.graphics).toEqual(output.graphics);
		expect(preview.canvasStyle).toEqual(output.canvasStyle);
		expect(output.itemGuides).toEqual([]);
		expect(preview.itemGuides.length).toBeGreaterThan(0);
	});

	it('offers advisory action-safe and title-safe guides only when the editor asks for them', () => {
		const withoutGuides = resolveGraphicsCompositionRenderModel({ output: 'overlay', graphics: [], ...CANVAS });
		const withGuides = resolveGraphicsCompositionRenderModel({
			output: 'overlay',
			graphics: [],
			safeAreaGuides: true,
			...CANVAS,
		});

		expect(withoutGuides.safeAreaGuides).toEqual([]);
		expect(withGuides.safeAreaGuides.map(guide => guide.id)).toEqual(['action-safe', 'title-safe']);
		expect(withGuides.safeAreaGuides[0]?.style).toMatchObject({ left: '96px', top: '54px', width: '1728px', height: '972px' });
		expect(withGuides.safeAreaGuides[1]?.style).toMatchObject({ left: '192px', top: '108px', width: '1536px', height: '864px' });
	});

	it('never lets advisory guides constrain or clip an authored Graphic Item', () => {
		const outsideTitleSafe = shape('edge', { x: 0, y: 0, width: 1920, height: 1080 });

		const model = resolveGraphicsCompositionRenderModel({
			output: 'overlay',
			graphics: [graphic('a', [outsideTitleSafe])],
			safeAreaGuides: true,
			...CANVAS,
		});

		expect(model.graphics[0]?.items[0]?.style).toMatchObject({
			left: '0px',
			top: '0px',
			width: '1920px',
			height: '1080px',
		});
	});

	it('offers item guides only when the editor asks for them, marking the selected Graphic Item', () => {
		const graphics = [graphic('a', [shape('bar'), shape('badge')])];

		expect(resolveGraphicsCompositionRenderModel({ output: 'overlay', graphics, ...CANVAS }).itemGuides).toEqual([]);

		const model = resolveGraphicsCompositionRenderModel({
			output: 'overlay',
			graphics,
			itemGuides: true,
			selectedTarget: { type: 'item', graphicId: 'a', itemId: 'badge' },
			...CANVAS,
		});

		expect(model.itemGuides.map(guide => [guide.itemId, guide.selected])).toEqual([
			['bar', false],
			['badge', true],
		]);
	});

	it('guides a canvas Graphic Group child at its own place on the canvas', () => {
		const model = resolveGraphicsCompositionRenderModel({
			output: 'overlay',
			graphics: [graphic('a', [
				group('canvas-cluster', [shape('badge', { x: 20, y: 5 })], { arrangement: 'canvas', padding: 10 }),
				group('row-cluster', [shape('laid-out')]),
			])],
			itemGuides: true,
			...CANVAS,
		});

		// A row child's rectangle is decided by layout, so the model offers no guide.
		expect(model.itemGuides.map(guide => guide.itemId)).toEqual(['canvas-cluster', 'badge', 'row-cluster']);
		expect(model.itemGuides[1]?.style).toMatchObject({ left: '130px', top: '215px' });
	});

	it('marks which composed Graphic Items belong to the Broadcast Graphic under authoring', () => {
		const model = resolveGraphicsCompositionRenderModel({
			output: 'overlay',
			graphics: [graphic('bug', [shape('logo')]), graphic('lower-third', [shape('bar')])],
			itemGuides: true,
			selectedTarget: { type: 'graphic', graphicId: 'lower-third' },
			...CANVAS,
		});

		expect(model.itemGuides.map(guide => [guide.itemId, guide.inSelectedGraphic, guide.selected])).toEqual([
			['logo', false, false],
			['bar', true, false],
		]);
	});
});
