import type { CSSProperties } from 'vue';
import type {
	BroadcastGraphicConfig,
	GraphicGroupChildConfig,
	GraphicGroupItemConfig,
	GraphicSurfaceStyle,
	MediaGraphicItemConfig,
	ShapeGraphicItemConfig,
	TextGraphicItemConfig,
} from '~~/shared/types/graphics';
import type { GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import type {
	GraphicItemRenderDescriptor,
	GraphicMediaRenderDescriptor,
	GraphicSurfaceRenderDescriptor,
} from '~/modules/graphics/renderModel';
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

const ASSET: GraphicAssetReference = {
	assetId: 'asset-1' as GraphicAssetReference['assetId'],
	revisionId: 'revision-7' as GraphicAssetReference['revisionId'],
};

/** Resolves exactly the way a Screen Output's capability-backed resolver does. */
function contentUrl(reference: GraphicAssetReference): string {
	return `/api/screen-output/screens/9/assets/${reference.assetId}/revisions/${reference.revisionId}/content`;
}

function media(id: string, overrides: Partial<MediaGraphicItemConfig> = {}): MediaGraphicItemConfig {
	return {
		type: 'media',
		id,
		label: id,
		visible: true,
		anchor: 'top-left',
		x: 40,
		y: 60,
		width: 480,
		height: 270,
		asset: ASSET,
		mediaKind: 'image',
		fit: 'cover',
		focalPosition: { horizontal: 0.5, vertical: 0.5 },
		opacity: 1,
		playbackRate: 1,
		loop: true,
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

const WHITE = /^#ffffff(?:[\da-f]{2})?$/i;

/** The one filter the Key Output may carry: a white glow, and nothing else. */
const WHITE_GLOW = /^drop-shadow\(0 0 [\d.]+px (#ffffff[\da-f]{2})\)$/i;

/**
 * Anything that could be a colour, in any CSS form an authored value might reach.
 * Deliberately broad: a false positive fails loudly, which is the safe direction,
 * while a missed form would let colour into the matte unnoticed.
 */
const COLOUR_TOKEN = /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\([^)]*\)|\b(?:red|green|blue|black|cyan|magenta|yellow|orange|purple|pink|brown|gray|grey|silver|gold|teal|navy|olive|lime|aqua|fuchsia|maroon|rebeccapurple|currentcolor)\b/gi;

/**
 * The one style key allowed to carry a colour. Every other key carrying one is an
 * unrecognised paint and fails.
 */
const RECOGNISED_COLOUR_KEYS = new Set(['color']);

/**
 * The one filter a Media Graphic Item's element may carry in the Key Output: the
 * alpha-as-white conversion, and nothing else.
 *
 * Written out rather than imported so the guard states the requirement
 * independently of the module it guards. A model that changed the conversion —
 * or dropped it — would still have to satisfy this exact string.
 */
const KEY_MEDIA_ALPHA_TO_WHITE = 'brightness(0) invert(1)';

/**
 * Every style property the render model is known to emit that cannot paint.
 *
 * This, rather than colour detection, is what keeps the guard closed against
 * property drift: a property that is not on this list fails whatever its value,
 * so a later addition reaching for `background`, `boxShadow`, or
 * `WebkitTextStroke` is caught by its key alone and never has to be recognised as
 * a colour first. #63 painted through `style.background`, so that drift is not
 * hypothetical. Adding a layout property here is the moment to ask whether it
 * paints.
 */
const NON_PAINTING_KEYS = new Set([
	'alignItems',
	'alignSelf',
	'boxSizing',
	'clipPath',
	'display',
	'flex',
	'flexDirection',
	'fontFamily',
	'fontSize',
	'fontStyle',
	'fontWeight',
	'gap',
	'height',
	'justifyContent',
	'left',
	'letterSpacing',
	'lineHeight',
	'margin',
	'minHeight',
	'minWidth',
	'overflow',
	'overflowWrap',
	'padding',
	'position',
	'textAlign',
	'textOverflow',
	'textTransform',
	'top',
	'transform',
	'transformOrigin',
	'WebkitBoxOrient',
	'WebkitLineClamp',
	'whiteSpace',
	'width',
]);

/**
 * Every colour one style object paints, and proof that it paints nothing else.
 *
 * Inverted on purpose. "Any colour I find must be white" passes whenever the
 * search misses a colour; this asserts instead that no unrecognised paint may
 * exist — an unknown key carrying a colour, or a filter that is not exactly one
 * white drop-shadow, throws rather than being quietly skipped.
 */
function stylePaints(style: CSSProperties, path: string): KeyPaint[] {
	const paints: KeyPaint[] = [];

	for (const [key, value] of Object.entries(style)) {
		if (value === undefined || value === null)
			continue;

		const text = String(value);

		if (key === 'filter') {
			const glow = WHITE_GLOW.exec(text);
			if (!glow)
				throw new Error(`${path}.filter must be exactly one white drop-shadow, got: ${text}`);
			paints.push({ color: glow[1]!, opacity: 1 });
			continue;
		}

		if (!RECOGNISED_COLOUR_KEYS.has(key) && !NON_PAINTING_KEYS.has(key))
			throw new Error(`${path}.${key} is an unrecognised style property in the Key Output: ${text}`);

		const tokens = text.match(COLOUR_TOKEN) ?? [];
		if (tokens.length === 0)
			continue;
		if (!RECOGNISED_COLOUR_KEYS.has(key))
			throw new Error(`${path}.${key} is an unrecognised paint in the Key Output: ${text}`);

		for (const token of tokens) {
			if (!WHITE.test(token))
				throw new Error(`${path}.${key} must paint white, got: ${token}`);
			paints.push({ color: token, opacity: 1 });
		}
	}

	return paints;
}

/**
 * Every style property a Media Graphic Item's element is known to emit that
 * cannot paint. Deliberately its own allowlist rather than a few additions to
 * `NON_PAINTING_KEYS`: `objectFit`, `objectPosition`, and `opacity` are
 * meaningless on an item, text, or surface style, and an element paint appearing
 * on one of those should still fail by key alone.
 */
const MEDIA_NON_PAINTING_KEYS = new Set([
	'display',
	'height',
	'objectFit',
	'objectPosition',
	'opacity',
	'width',
]);

/**
 * What one Media Graphic Item paints, and proof that it paints white.
 *
 * An image or video element cannot be recoloured by a CSS paint property, so the
 * check is inverted from the surface one: rather than asserting a colour is
 * white, it asserts the alpha-as-white conversion is present. Without it the
 * element paints the asset's own colours straight into the matte — which looks
 * perfect in the Overlay Output and silently corrupts the keyed feed, the exact
 * failure this guard exists to catch.
 *
 * An unresolved reference paints nothing, so it contributes no paint. A resolved
 * one contributes white at the element's opacity: the worst case for the matte,
 * a fully opaque region of the asset.
 */
function mediaPaints(media: GraphicMediaRenderDescriptor, path: string): KeyPaint[] {
	for (const [key, value] of Object.entries(media.style)) {
		if (value === undefined || value === null)
			continue;
		const text = String(value);

		if (key === 'filter') {
			if (text !== KEY_MEDIA_ALPHA_TO_WHITE)
				throw new Error(`${path}.media.filter must be exactly the alpha-as-white conversion, got: ${text}`);
			continue;
		}

		if (!MEDIA_NON_PAINTING_KEYS.has(key))
			throw new Error(`${path}.media.${key} is an unrecognised style property in the Key Output: ${text}`);
		if ((text.match(COLOUR_TOKEN) ?? []).length > 0)
			throw new Error(`${path}.media.${key} is an unrecognised paint in the Key Output: ${text}`);
	}

	if (media.src === '')
		return [];
	if (media.style.filter !== KEY_MEDIA_ALPHA_TO_WHITE)
		throw new Error(`${path}.media paints its own colours into the Key Output instead of its alpha as white`);

	return [{ color: '#ffffff', opacity: Number(media.style.opacity ?? 1) }];
}

function surfacePaints(surface: GraphicSurfaceRenderDescriptor, path: string): KeyPaint[] {
	const paints: KeyPaint[] = [];
	const gradient = surface.fill.gradient;

	if (gradient) {
		for (const stop of gradient.stops) {
			if (!WHITE.test(stop.color))
				throw new Error(`${path} gradient stop must paint white, got: ${stop.color}`);
			paints.push({ color: stop.color, opacity: stop.opacity * surface.fill.opacity });
		}
	}
	else {
		if (!WHITE.test(surface.fill.color))
			throw new Error(`${path} fill must paint white, got: ${surface.fill.color}`);
		paints.push({ color: surface.fill.color, opacity: surface.fill.opacity });
	}

	if (surface.outline) {
		if (!WHITE.test(surface.outline.color))
			throw new Error(`${path} outline must paint white, got: ${surface.outline.color}`);
		paints.push({ color: surface.outline.color, opacity: 1 });
	}

	return paints;
}

/**
 * Every colour one Graphic Item paints, in paint order, proving as it goes that
 * the item paints nothing the matte identity does not allow.
 */
function itemPaints(item: GraphicItemRenderDescriptor, prefix = ''): KeyPaint[] {
	const path = `${prefix}${item.id}`;

	return [
		...stylePaints(item.style, path),
		...(item.textStyle ? stylePaints(item.textStyle, `${path}.textStyle`) : []),
		...(item.surface ? surfacePaints(item.surface, path) : []),
		...(item.media ? mediaPaints(item.media, path) : []),
		...(item.children ?? []).flatMap(child => itemPaints(child, `${path}>`)),
	];
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
		expect(fill?.color).toBe('url(#graphic-fill-a-bed)');
		// Ninety degrees points right, so the axis runs across the surface.
		expect(fill?.gradient).toMatchObject({
			id: 'graphic-fill-a-bed',
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
		expect(surface?.outline).toEqual({ color: '#00d9ff', width: 3, clipId: 'graphic-outline-a-bar' });
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

	describe('media Graphic Items', () => {
		it('fits an asset inside the authored bounds at its focal position and opacity', () => {
			const model = resolveGraphicsCompositionRenderModel({
				output: 'overlay',
				graphics: [graphic('a', [
					media('cover'),
					media('contained', { fit: 'contain', opacity: 0.4, focalPosition: { horizontal: 0, vertical: 1 } }),
					media('filled', { fit: 'fill' }),
				])],
				graphicAssetContentUrl: contentUrl,
				...CANVAS,
			});

			const [cover, contained, filled] = model.graphics[0]!.items;
			expect(cover?.kind).toBe('media');
			expect(cover?.media?.style).toMatchObject({
				objectFit: 'cover',
				objectPosition: '50% 50%',
				opacity: 1,
			});
			expect(contained?.media?.style).toMatchObject({
				objectFit: 'contain',
				objectPosition: '0% 100%',
				opacity: 0.4,
			});
			expect(filled?.media?.style.objectFit).toBe('fill');
			// A cover fit overflows the box it fills, so the item always hides overflow.
			for (const item of [cover, contained, filled])
				expect(item?.style.overflow).toBe('hidden');
		});

		it('resolves content only through the resolver its output supplies', () => {
			// A Screen Output supplies a resolver backed by its Screen Output Asset
			// Capability. The model never derives a library URL of its own, so there is
			// no path by which an output could reach unpublished library content.
			const graphics = [graphic('a', [media('logo')])];

			const resolved = resolveGraphicsCompositionRenderModel({
				output: 'overlay',
				graphics,
				graphicAssetContentUrl: contentUrl,
				...CANVAS,
			});
			const withoutResolver = resolveGraphicsCompositionRenderModel({
				output: 'overlay',
				graphics,
				...CANVAS,
			});

			expect(resolved.graphics[0]?.items[0]?.media?.src)
				.toBe('/api/screen-output/screens/9/assets/asset-1/revisions/revision-7/content');
			expect(withoutResolver.graphics[0]?.items[0]?.media?.src).toBe('');
		});

		it('paints nothing for an item with no asset pinned, and still occupies its bounds', () => {
			const model = resolveGraphicsCompositionRenderModel({
				output: 'overlay',
				graphics: [graphic('a', [media('empty', { asset: undefined })])],
				graphicAssetContentUrl: contentUrl,
				...CANVAS,
			});

			const item = model.graphics[0]?.items[0];
			expect(item?.media?.src).toBe('');
			expect(item?.style).toMatchObject({ left: '40px', top: '60px', width: '480px', height: '270px' });
		});

		it('carries silent-video playback and starts from the beginning by construction', () => {
			// Nothing in the model expresses a playback position: an element created
			// when its graphic enters starts at zero, so "from its start" is a property
			// of mounting the element rather than a value to carry.
			const model = resolveGraphicsCompositionRenderModel({
				output: 'overlay',
				graphics: [graphic('a', [media('sting', {
					mediaKind: 'silent-video',
					playbackRate: 0.5,
					loop: false,
					videoCompatibility: 'chromium-transparency',
				})])],
				graphicAssetContentUrl: contentUrl,
				...CANVAS,
			});

			expect(model.graphics[0]?.items[0]?.media).toMatchObject({
				mediaKind: 'silent-video',
				playbackRate: 0.5,
				loop: false,
				videoCompatibility: 'chromium-transparency',
			});
			// Nothing in the descriptor expresses where playback should start, because
			// nothing needs to: the element is created when the graphic enters.
			expect(Object.keys(model.graphics[0]!.items[0]!.media!).sort()).toEqual([
				'loop',
				'mediaKind',
				'playbackRate',
				'src',
				'style',
				'videoCompatibility',
			]);
		});

		it('clips to an optional Shape Geometry, and to its own rectangle without one', () => {
			const clipped = resolveGraphicsCompositionRenderModel({
				output: 'overlay',
				graphics: [graphic('a', [media('angled', {
					width: 600,
					height: 120,
					clipGeometry: { ...squareShapeGeometry(), rightSlant: 60 },
				})])],
				graphicAssetContentUrl: contentUrl,
				...CANVAS,
			});
			const rectangular = resolveGraphicsCompositionRenderModel({
				output: 'overlay',
				graphics: [graphic('a', [media('plain', { clipGeometry: squareShapeGeometry() })])],
				graphicAssetContentUrl: contentUrl,
				...CANVAS,
			});
			const unclipped = resolveGraphicsCompositionRenderModel({
				output: 'overlay',
				graphics: [graphic('a', [media('plain')])],
				graphicAssetContentUrl: contentUrl,
				...CANVAS,
			});

			// The canonical Shape Geometry path, identical to the one a Shape Graphic
			// Item of the same size and geometry draws.
			expect(clipped.graphics[0]?.items[0]?.style.clipPath)
				.toBe(`path('M 0 0 L 540 0 L 600 120 L 0 120 Z')`);
			expect(rectangular.graphics[0]?.items[0]?.style.clipPath).toBeUndefined();
			expect(unclipped.graphics[0]?.items[0]?.style.clipPath).toBeUndefined();
		});

		it('clips a Graphic Group child against the box it really occupies, or not at all', () => {
			// A `path()` clip is in user units, so it is only right against the box it
			// was measured from. A fixed-size child in a non-stretching group has a
			// known box; a weighted-fill or stretched child's box is the browser's, and
			// a path measured against the authored rectangle would clip the wrong shape
			// while looking deliberate.
			const angled = { ...squareShapeGeometry(), rightSlant: 30 };

			function childStyle(overrides: Parameters<typeof group>[2], childOverrides = {}) {
				const model = resolveGraphicsCompositionRenderModel({
					output: 'overlay',
					graphics: [graphic('a', [group('cluster', [
						media('badge', { width: 200, height: 100, clipGeometry: angled, ...childOverrides }),
					], overrides)])],
					graphicAssetContentUrl: contentUrl,
					...CANVAS,
				});
				return model.graphics[0]!.items[0]!.children![0]!.style;
			}

			// Fixed main axis, group not stretching: the box is known, so the clip applies.
			expect(childStyle({ align: 'center' }, { sizing: { mode: 'fixed', size: 160, weight: 1 } }).clipPath)
				.toBe(`path('M 0 0 L 130 0 L 160 100 L 0 100 Z')`);
			// Weighted fill: the main extent is the browser's.
			expect(childStyle({ align: 'center' }, { sizing: { mode: 'fill', size: 0, weight: 1 } }).clipPath)
				.toBeUndefined();
			// Stretching: the cross extent is the browser's.
			expect(childStyle({ align: 'stretch' }, { sizing: { mode: 'fixed', size: 160, weight: 1 } }).clipPath)
				.toBeUndefined();
			// A canvas child keeps its authored rectangle either way.
			expect(childStyle({ arrangement: 'canvas' }).clipPath)
				.toBe(`path('M 0 0 L 170 0 L 200 100 L 0 100 Z')`);
			// Whichever way, the item never paints outside its own bounds.
			for (const style of [
				childStyle({ align: 'center' }, { sizing: { mode: 'fill', size: 0, weight: 1 } }),
				childStyle({ align: 'stretch' }),
			])
				expect(style.overflow).toBe('hidden');
		});

		it('places a Media Graphic Item inside a Graphic Group like any other child', () => {
			const model = resolveGraphicsCompositionRenderModel({
				output: 'overlay',
				graphics: [graphic('a', [group('cluster', [
					media('badge', { sizing: { mode: 'fixed', size: 120, weight: 1 } }),
				], {
					// A Media Graphic Item paints no surface, so a group style default has
					// nothing on it to fill in.
					defaultChildSurfaceStyle: { fill: { type: 'solid', color: '#00ff00' }, fillOpacity: 1 },
				})])],
				graphicAssetContentUrl: contentUrl,
				...CANVAS,
			});

			const child = model.graphics[0]!.items[0]!.children![0]!;
			expect(child.kind).toBe('media');
			expect(child.style.flex).toBe('0 0 120px');
			expect(child.surface).toBeUndefined();
			expect(child.media?.src).not.toBe('');
		});

		it('paints no Graphic Surface Style and no glow of its own', () => {
			const model = resolveGraphicsCompositionRenderModel({
				output: 'overlay',
				graphics: [graphic('a', [media('logo')])],
				graphicAssetContentUrl: contentUrl,
				...CANVAS,
			});

			expect(model.graphics[0]?.items[0]?.surface).toBeUndefined();
			expect(model.graphics[0]?.items[0]?.style.filter).toBeUndefined();
		});
	});

	it('scopes gradient and clip element ids to the whole composition', () => {
		// Concurrent Broadcast Graphics composite into one document, and SVG
		// `url(#id)` resolution is document-scoped, so two items sharing an id across
		// graphics would paint the first one's gradient and clip to its path.
		const styled = {
			fill: {
				type: 'linear-gradient' as const,
				angle: 90,
				stops: [
					{ color: '#000000', position: 0, opacity: 1 },
					{ color: '#ffffff', position: 1, opacity: 1 },
				],
			},
			fillOpacity: 1,
			outline: { color: '#00d9ff', width: 2 },
		};

		const model = resolveGraphicsCompositionRenderModel({
			output: 'overlay',
			graphics: [
				graphic('bug', [shape('bed', { surfaceStyle: styled })]),
				graphic('lower-third', [group('cluster', [shape('bed', { surfaceStyle: styled })])]),
			],
			...CANVAS,
		});

		const [first, second] = model.graphics;
		const child = second!.items[0]!.children![0]!;

		expect(first!.items[0]!.surface?.fill.gradient?.id).toBe('graphic-fill-bug-bed');
		expect(child.surface?.fill.gradient?.id).toBe('graphic-fill-lower-third-bed');
		expect(first!.items[0]!.surface?.outline?.clipId).toBe('graphic-outline-bug-bed');
		expect(child.surface?.outline?.clipId).toBe('graphic-outline-lower-third-bed');
		expect(child.surface?.fill.color).toBe('url(#graphic-fill-lower-third-bed)');
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
				model.graphics[0]!.items.flatMap(item => itemPaints(item)),
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
				model.graphics[0]!.items.flatMap(item => itemPaints(item)),
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

		it('contributes a Media Graphic Item as its alpha in white, never as its own colours', () => {
			// The failure this prevents is asymmetric: a media element that keeps its
			// colours looks perfect in the Overlay Output and produces a matte that is
			// the asset's luminance instead of its alpha, so the downstream composite
			// is wrong only once it is on air.
			const graphics = [graphic('a', [media('logo')])];

			const overlay = resolveGraphicsCompositionRenderModel({
				output: 'overlay',
				graphics,
				graphicAssetContentUrl: contentUrl,
				...CANVAS,
			});
			const key = resolveGraphicsCompositionRenderModel({
				output: 'key',
				graphics,
				graphicAssetContentUrl: contentUrl,
				...CANVAS,
			});

			expect(overlay.graphics[0]?.items[0]?.media?.style.filter).toBeUndefined();
			expect(key.graphics[0]?.items[0]?.media?.style.filter).toBe(KEY_MEDIA_ALPHA_TO_WHITE);
			// Same asset, same fitting: the Key Output differs by the conversion alone,
			// so it resolves the same composition as the Overlay Output.
			expect(key.graphics[0]?.items[0]?.media?.src).toBe(overlay.graphics[0]?.items[0]?.media?.src);
			expect(key.graphics[0]?.items[0]?.style).toEqual(overlay.graphics[0]?.items[0]?.style);
		});

		it('accumulates a Media Graphic Item into the alpha union with the items it overlaps', () => {
			// A half-opaque media item over a half-opaque shape is the same 0.75 union as
			// two half-opaque shapes. If media painted its own luminance instead, this
			// number would move with the asset.
			const model = resolveGraphicsCompositionRenderModel({
				output: 'key',
				graphics: [graphic('a', [
					shape('under', { surfaceStyle: surfaceStyle({ fillOpacity: 0.5 }) }),
					media('over', { opacity: 0.5 }),
				])],
				graphicAssetContentUrl: contentUrl,
				...CANVAS,
			});

			const luminance = compositeKeyLuminance(
				model.canvasStyle.background,
				model.graphics[0]!.items.flatMap(item => itemPaints(item)),
			);

			expect(luminance).toBeCloseTo(0.75, 2);
		});

		it('lets an unresolved Media Graphic Item contribute no alpha at all', () => {
			// An empty or unresolvable reference paints nothing, so it must add nothing
			// to the matte either — an opaque white rectangle where content failed to
			// load would key a hole in program.
			const model = resolveGraphicsCompositionRenderModel({
				output: 'key',
				graphics: [graphic('a', [media('empty', { asset: undefined })])],
				graphicAssetContentUrl: contentUrl,
				...CANVAS,
			});

			const luminance = compositeKeyLuminance(
				model.canvasStyle.background,
				model.graphics[0]!.items.flatMap(item => itemPaints(item)),
			);

			expect(luminance).toBe(0);
		});

		it('fails closed on media: rejects an element paint the matte identity does not allow', () => {
			const probe = (style: CSSProperties, src = '/content'): GraphicItemRenderDescriptor => ({
				id: 'probe',
				label: 'probe',
				kind: 'media',
				style: {},
				media: {
					mediaKind: 'image',
					src,
					style,
					loop: true,
					playbackRate: 1,
				} satisfies GraphicMediaRenderDescriptor,
			});

			// The conversion missing altogether is the regression that matters most.
			expect(() => itemPaints(probe({ opacity: 1 })))
				.toThrow(/paints its own colours into the Key Output/);

			// A conversion that only looks right must fail too: `grayscale` maps colour
			// to its luminance, which is precisely the wrong matte.
			for (const filter of [
				'grayscale(1)',
				'brightness(0)',
				'invert(1)',
				'brightness(0) invert(1) blur(2px)',
				'drop-shadow(0 0 8px #ffffff80)',
			])
				expect(() => itemPaints(probe({ filter }))).toThrow(/alpha-as-white conversion/);

			// And an element reaching for a paint property of its own is caught by key.
			expect(() => itemPaints(probe({ filter: KEY_MEDIA_ALPHA_TO_WHITE, backgroundColor: '#ff0000' })))
				.toThrow(/unrecognised style property/);
			expect(() => itemPaints(probe({ filter: KEY_MEDIA_ALPHA_TO_WHITE, mixBlendMode: 'screen' })))
				.toThrow(/unrecognised style property/);

			// What the model really does emit still passes.
			expect(() => itemPaints(probe({
				display: 'block',
				width: '100%',
				height: '100%',
				objectFit: 'cover',
				objectPosition: '50% 50%',
				opacity: 0.5,
				filter: KEY_MEDIA_ALPHA_TO_WHITE,
			}))).not.toThrow();
			// An unresolved reference is exempt from needing the conversion: it paints
			// nothing, so there is nothing to convert.
			expect(() => itemPaints(probe({ opacity: 1 }, ''))).not.toThrow();
		});

		it('fails closed: rejects any paint the matte identity does not allow', () => {
			// The guard above is only worth having if it cannot be satisfied by a
			// colour it failed to recognise. Every one of these is a way colour could
			// reach a Key Output — an authored colour in a form the schema accepts, a
			// second shadow in a filter chain, or a paint on a property nothing here
			// knows about — and each one has to throw rather than be skipped.
			const white = (style: CSSProperties): GraphicItemRenderDescriptor => ({
				id: 'probe',
				label: 'probe',
				kind: 'shape',
				style,
			});

			for (const filter of [
				'drop-shadow(0 0 24px rgba(255, 0, 0, 0.5))',
				'drop-shadow(0 0 24px red)',
				'drop-shadow(0 0 24px oklch(0.7 0.2 20))',
				'drop-shadow(0 0 24px color-mix(in srgb, #ff0000 50%, transparent))',
				'drop-shadow(0 0 24px #0077a3)',
				'drop-shadow(0 0 24px #ffffff80) drop-shadow(0 0 8px #ff0000)',
				'blur(4px)',
			])
				expect(() => itemPaints(white({ filter }))).toThrow(/drop-shadow/);

			expect(() => itemPaints(white({ background: '#ff0000' })))
				.toThrow(/unrecognised style property/);
			expect(() => itemPaints(white({ boxShadow: '0 0 8px rgba(255,0,0,0.5)' })))
				.toThrow(/unrecognised style property/);
			expect(() => itemPaints(white({ color: '#ff0000' })))
				.toThrow(/must paint white/);

			// A new painting property is caught by its key alone, so the guard does not
			// depend on recognising every CSS colour form. `ButtonFace` is a system
			// colour keyword no colour pattern here would match.
			expect(() => itemPaints(white({ backgroundColor: 'ButtonFace' })))
				.toThrow(/unrecognised style property/);
			expect(() => itemPaints(white({ WebkitTextStrokeColor: 'papayawhip' })))
				.toThrow(/unrecognised style property/);

			// A hidden paint inside a Graphic Group child is found too.
			expect(() => itemPaints({
				...white({}),
				children: [white({ background: 'red' })],
			})).toThrow(/unrecognised style property/);

			// And the shapes the model really does emit still pass.
			expect(() => itemPaints(white({ filter: 'drop-shadow(0 0 20px #ffffff80)' }))).not.toThrow();
			expect(() => itemPaints(white({ clipPath: `path('M 0 0 L 10 0 L 10 10 Z')` }))).not.toThrow();
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
					media('picture', { clipGeometry: { ...squareShapeGeometry(), leftSlant: 20 } }),
					group('cluster', [
						shape('child', { surfaceStyle: loud }),
						text('child-name', { typography: { ...DEFAULT_GRAPHIC_TYPOGRAPHY, color: '#321048' } }),
						media('child-picture', { mediaKind: 'silent-video' }),
					], { surfaceStyle: loud, defaultChildSurfaceStyle: loud }),
				])],
				graphicAssetContentUrl: contentUrl,
				...CANVAS,
			});

			// Exactly what the four items paint: a glow, three gradient stops and an
			// outline each, plus one text colour each for the two text items, the
			// group's own surface on top of its three children, and one white
			// contribution for each of the two Media Graphic Items.
			const paints = model.graphics[0]!.items.flatMap(item => itemPaints(item));
			expect(paints).toHaveLength(29);
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
