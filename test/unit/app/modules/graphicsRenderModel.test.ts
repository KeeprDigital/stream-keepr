import type { CSSProperties } from 'vue';
import type {
	BroadcastGraphicConfig,
	GraphicGroupChildConfig,
	GraphicGroupItemConfig,
	GraphicInputDeclaration,
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
	// Graphic Animation and Media Graphic Items both need this one, and both
	// arrived at it the same way. `opacity` scales an element's own alpha, which
	// the matte identity is already stated over: it multiplies through exactly as
	// a Graphic Group's opacity does, so it is a factor on existing paint rather
	// than paint of its own.
	'opacity',
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
	// An update phase's outgoing copy keeps the boxes of the owners that are *not*
	// cross-transitioning, so both copies lay out identically, and hides them so the
	// content they share with the incoming copy is still painted exactly once.
	// `visibility` removes paint rather than adding any, so it can only ever lower an
	// element's contribution to the matte — the safe direction, and the only one of the
	// two that could not break the identity.
	'visibility',
	'WebkitBoxOrient',
	'WebkitLineClamp',
	'whiteSpace',
	'width',
]);

/**
 * The one mask the Key Output may carry: a hard-edged wipe in white at full and
 * zero alpha, and nothing else.
 *
 * A mask multiplies the element's alpha rather than adding paint, so it is not
 * pushed as a paint — but it is still required to be written in white, because a
 * mask that ever did paint must fail the same check as everything else, and
 * because an authored colour appearing here would mean a reveal had been
 * implemented as something other than a stencil.
 */
const WHITE_WIPE_MASK = /^linear-gradient\(to (?:right|left|bottom|top), #ffffff 0 [\d.]+%, #ffffff00 [\d.]+%\)$/i;

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

		if (key === 'maskImage') {
			if (!WHITE_WIPE_MASK.test(text))
				throw new Error(`${path}.maskImage must be exactly one white wipe, got: ${text}`);
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
 * What a Media Graphic Item's element adds to the non-painting properties every
 * other descriptor may carry.
 *
 * Only the delta: `objectFit` and `objectPosition` are meaningless anywhere but on
 * a replaced element, so they stay out of the shared set — while the layout
 * properties and `opacity` a media element shares with every other item have one
 * home in `NON_PAINTING_KEYS`. A media element is checked against both sets, so a
 * property that paints is in neither and still fails by key alone.
 */
const MEDIA_NON_PAINTING_KEYS = new Set([
	'objectFit',
	'objectPosition',
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

		if (!MEDIA_NON_PAINTING_KEYS.has(key) && !NON_PAINTING_KEYS.has(key))
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
		// A Graphic Placeholder Style paints one run of a rendered Graphic Text
		// Template, so it is a painting surface like any other and has to be walked.
		// Leaving it out would let a placeholder style that later gained a background
		// or a text stroke reach the matte unnoticed, and would keep a segment's own
		// alpha out of the union arithmetic below.
		...(item.textSegments ?? []).flatMap((segment, index) =>
			segment.style ? stylePaints(segment.style, `${path}.textSegments[${index}]`) : []),
		// A Graphic Placeholder Style paints one run of a rendered Graphic Text
		// Template, so it is a painting surface like any other and has to be walked.
		// Leaving it out would let a placeholder style that later gained a background
		// or a text stroke reach the matte unnoticed, and would keep a segment's own
		// alpha out of the union arithmetic below.
		...(item.surface ? surfacePaints(item.surface, path) : []),
		...(item.media ? mediaPaints(item.media, path) : []),
		...(item.children ?? []).flatMap(child => itemPaints(child, `${path}>`)),
	];
}

/** Every colour one composed Broadcast Graphic paints, its own wrapper included. */
function graphicPaints(graphic: { id: string; style?: CSSProperties; items: GraphicItemRenderDescriptor[] }): KeyPaint[] {
	return [
		...(graphic.style ? stylePaints(graphic.style, `${graphic.id}.style`) : []),
		...graphic.items.flatMap(item => itemPaints(item, `${graphic.id}>`)),
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

		it('paints a Graphic Placeholder Style in the Key Output as white, and counts its run in the matte', () => {
			// A placeholder style is a painting surface of its own, so it has to obey the
			// matte identity like any other. This composes one so the guard above walks a
			// styled run rather than an empty list — an authored colour here must resolve
			// to white, and the run's own alpha must reach the union arithmetic.
			const model = resolveGraphicsCompositionRenderModel({
				output: 'key',
				graphics: [{
					id: 'a',
					name: 'a',
					inputs: [{
						type: 'text',
						key: 'name',
						label: 'Name',
						required: false,
						updatePolicy: 'staged',
						default: 'Ava Reed',
						maxLength: 40,
					}],
					items: [text('line', {
						text: 'Live: {name}',
						placeholderStyles: { name: { color: '#ff0000', fontWeight: 300 } },
					})],
				}],
				...CANVAS,
			});

			const segments = model.graphics[0]!.items[0]!.textSegments!;
			const styled = segments.find(segment => segment.inputKey === 'name');

			expect(styled?.text).toBe('Ava Reed');
			expect(styled?.style?.color).toBe('#ffffff');
			// Non-vacuous: the guard is walking a run that really carries a style.
			expect(itemPaints(model.graphics[0]!.items[0]!).length).toBeGreaterThan(0);
			expect(() => itemPaints(model.graphics[0]!.items[0]!)).not.toThrow();
		});

		it('refuses a Graphic Placeholder Style that would paint its own colour into the Key Output', () => {
			// The guard's whole purpose: a placeholder style that gained a background or a
			// text stroke would otherwise reach the matte unnoticed.
			expect(() => itemPaints({
				id: 'line',
				label: 'line',
				kind: 'text',
				style: { color: '#ffffff' },
				textSegments: [{ text: 'Ava Reed', inputKey: 'name', style: { background: '#ff0000' } }],
			})).toThrow(/textSegments\[0\]/);
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

describe('graphicsCompositionRenderModel Graphic Animation', () => {
	const LINEAR = { duration: 400, easing: 'linear' as const, delay: 0 };

	function model(graphics: BroadcastGraphicConfig[], animation?: Record<string, { phase: 'enter' | 'on-screen' | 'update' | 'exit'; elapsed: number }>, output: 'overlay' | 'fill' | 'key' = 'overlay') {
		return resolveGraphicsCompositionRenderModel({ output, graphics, animation, ...CANVAS });
	}

	describe('an update phase draws both renderings', () => {
		const HEADLINE: GraphicInputDeclaration = {
			key: 'headline',
			label: 'Headline',
			required: false,
			updatePolicy: 'staged',
			type: 'text',
			default: '',
			maxLength: 80,
		};

		const CROSS_FADE = { ...LINEAR, fade: { opacity: 0 } };

		function updating(
			graphics: BroadcastGraphicConfig[],
			elapsed = 200,
			output: 'overlay' | 'fill' | 'key' = 'overlay',
		) {
			return resolveGraphicsCompositionRenderModel({
				output,
				graphics,
				animation: { a: { phase: 'update', elapsed } },
				inputValues: { a: { headline: 'AFTER' } },
				outgoingInputValues: { a: { headline: 'BEFORE' } },
				...CANVAS,
			});
		}

		function headlineGraphic(items: BroadcastGraphicConfig['items'], animation?: BroadcastGraphicConfig['animation']) {
			return { ...graphic('a', items), inputs: [HEADLINE], animation };
		}

		it('renders the old text alongside the new one, each on its own half of the recipe', () => {
			const model = updating([headlineGraphic([
				text('headline', { text: '{headline}', animation: { update: CROSS_FADE } }),
			])]);
			const composed = model.graphics[0]!;

			expect(composed.items[0]?.text).toBe('AFTER');
			expect(composed.outgoing?.items[0]?.text).toBe('BEFORE');
			// Halfway through a cross-fade, each rendering is half present.
			expect(composed.items[0]?.style.opacity).toBe(0.5);
			expect(composed.outgoing?.items[0]?.style.opacity).toBe(0.5);
		});

		it('draws no outgoing rendering outside an update phase', () => {
			const items = [text('headline', { text: '{headline}', animation: { update: CROSS_FADE, enter: CROSS_FADE } })];

			for (const phase of ['enter', 'exit', 'on-screen'] as const) {
				const model = resolveGraphicsCompositionRenderModel({
					output: 'overlay',
					graphics: [headlineGraphic(items)],
					animation: { a: { phase, elapsed: 200 } },
					inputValues: { a: { headline: 'AFTER' } },
					outgoingInputValues: { a: { headline: 'BEFORE' } },
					...CANVAS,
				});

				expect(model.graphics[0]?.outgoing).toBeUndefined();
			}
		});

		it('draws no outgoing rendering when no rendered content changed', () => {
			const model = resolveGraphicsCompositionRenderModel({
				output: 'overlay',
				graphics: [headlineGraphic([text('headline', { text: '{headline}', animation: { update: CROSS_FADE } })])],
				animation: { a: { phase: 'update', elapsed: 200 } },
				inputValues: { a: { headline: 'SAME' } },
				outgoingInputValues: { a: { headline: 'SAME' } },
				...CANVAS,
			});

			expect(model.graphics[0]?.outgoing).toBeUndefined();
		});

		it('draws no outgoing rendering for an item that has no update recipe, so it cuts', () => {
			const model = updating([headlineGraphic([text('headline', { text: '{headline}' })])]);

			expect(model.graphics[0]?.outgoing).toBeUndefined();
			expect(model.graphics[0]?.items[0]?.text).toBe('AFTER');
		});

		it('paints unchanged content exactly once, so a translucent panel cannot brighten', () => {
			// The regression this guards: drawing the whole graphic again would composite
			// a three-quarter-opaque panel with itself, and a panel that is meant to hold
			// still would visibly lift for the length of every update.
			const model = updating([headlineGraphic([
				shape('panel', { surfaceStyle: surfaceStyle({ fillOpacity: 0.75 }) }),
				text('headline', { text: '{headline}', animation: { update: CROSS_FADE } }),
			])]);
			const outgoing = model.graphics[0]!.outgoing!;

			// The panel keeps its box, so both copies lay out identically, and paints nothing.
			expect(outgoing.items[0]?.style.visibility).toBe('hidden');
			expect(outgoing.items[0]?.surface).toBeUndefined();
			expect(outgoing.items[1]?.text).toBe('BEFORE');
		});

		it('cross-transitions the whole graphic when the whole graphic authored an update', () => {
			// A whole-graphic update recipe is the case where drawing everything twice is
			// what the author asked for, so unchanged items are drawn in both copies.
			const model = updating([headlineGraphic(
				[
					shape('panel', { surfaceStyle: surfaceStyle({ fillOpacity: 0.75 }) }),
					text('headline', { text: '{headline}' }),
				],
				{ update: CROSS_FADE },
			)]);
			const composed = model.graphics[0]!;

			expect(composed.style?.opacity).toBe(0.5);
			expect(composed.outgoing?.style?.opacity).toBe(0.5);
			expect(composed.outgoing?.items[0]?.surface).toBeDefined();
			expect(composed.outgoing?.items[0]?.style.visibility).toBeUndefined();
			expect(composed.outgoing?.items[1]?.text).toBe('BEFORE');
		});

		it('keeps a row Graphic Group child in the same box in both copies', () => {
			const model = updating([headlineGraphic([
				group('cluster', [
					shape('badge'),
					text('headline', { text: '{headline}', animation: { update: CROSS_FADE } }),
				]),
			])]);
			const composed = model.graphics[0]!;
			const outgoing = composed.outgoing!;

			// The group survives so its flex layout is unchanged, but stops painting its
			// own surface — the incoming copy is already painting it.
			expect(outgoing.items[0]?.children?.map(child => child.id)).toEqual(['badge', 'headline']);
			expect(outgoing.items[0]?.children?.[0]?.style.flex).toBe(composed.items[0]?.children?.[0]?.style.flex);
			expect(outgoing.items[0]?.children?.[1]?.text).toBe('BEFORE');
		});

		it('notices a change that moves content between a Graphic Group\'s children', () => {
			// The group's own content is its children's, and comparing it means joining
			// them — so the join has to be separated. Concatenating with nothing would make
			// children reading "ab" and "c" indistinguishable from "a" and "bc", the group's
			// update recipe would be suppressed for a change that is plainly on screen, and
			// the new rendering would hard-cut in.
			const model = resolveGraphicsCompositionRenderModel({
				output: 'overlay',
				graphics: [{
					...graphic('a', [
						group('cluster', [
							text('first', { text: '{one}' }),
							text('second', { text: '{two}' }),
						], { animation: { update: CROSS_FADE } }),
					]),
					inputs: [
						{ ...HEADLINE, key: 'one' },
						{ ...HEADLINE, key: 'two' },
					],
				}],
				animation: { a: { phase: 'update', elapsed: 200 } },
				inputValues: { a: { one: 'a', two: 'bc' } },
				outgoingInputValues: { a: { one: 'ab', two: 'c' } },
				...CANVAS,
			});

			const outgoing = model.graphics[0]!.outgoing;
			expect(outgoing).toBeDefined();
			expect(outgoing?.items[0]?.children?.map(child => child.text)).toEqual(['ab', 'c']);
			expect(model.graphics[0]?.items[0]?.children?.map(child => child.text)).toEqual(['a', 'bc']);
		});

		it('keeps the Key Output a true alpha matte through a cross-transition', () => {
			for (const elapsed of [0, 100, 200, 399, 400]) {
				const model = updating([headlineGraphic([
					shape('panel', { surfaceStyle: surfaceStyle({ fillOpacity: 0.5 }) }),
					text('headline', {
						text: '{headline}',
						surfaceStyle: surfaceStyle({ fillOpacity: 0.5 }),
						animation: { update: { ...LINEAR, fade: { opacity: 0 }, reveal: { edge: 'left' }, slide: { direction: 'east', distanceMode: 'fixed', distance: 40 } } },
					}),
				])], elapsed, 'key');
				const composed = model.graphics[0]!;

				expect(() => graphicPaints(composed)).not.toThrow();
				expect(() => graphicPaints({ id: `${composed.id}-outgoing`, ...composed.outgoing! })).not.toThrow();
			}
		});

		it('accumulates the outgoing rendering into the matte by the same identity as the incoming one', () => {
			// The second rendering is a second painted element, so the question is whether
			// it paints white at its own alpha like everything else. Two half-opaque
			// surfaces union to 1 - (1 - 0.5)(1 - 0.5) = 0.75, independent of this module
			// — and the outgoing copy has to reach that number rather than, say, keeping an
			// authored colour that would leave the Key Output brighter or darker than the
			// alpha it is supposed to be reporting. The fade factor is deliberately outside
			// this arithmetic: element `opacity` multiplies through both outputs equally,
			// which is why the harness treats it as a factor on paint rather than as paint.
			const model = updating([headlineGraphic(
				[
					shape('panel', { surfaceStyle: surfaceStyle({ fill: { type: 'solid', color: '#123456' }, fillOpacity: 0.5 }) }),
					text('headline', { text: '{headline}' }),
				],
				{ update: CROSS_FADE },
			)], 200, 'key');
			const composed = model.graphics[0]!;

			// The panel, drawn once by each copy because the whole graphic is what is
			// cross-transitioning. A Text Graphic Item paints its glyphs at full alpha, so
			// it is left out of the arithmetic rather than dominating it.
			const luminance = compositeKeyLuminance(model.canvasStyle.background, [
				...itemPaints(composed.outgoing!.items[0]!),
				...itemPaints(composed.items[0]!),
			]);

			expect(luminance).toBeCloseTo(0.75, 3);
		});
	});

	it('renders the Graphic Resting State when nothing is being projected', () => {
		// The unanimated Screen, the settled on-air graphic, and the recovered Live
		// Session all reach the model as an absent projection, and all three have to
		// produce exactly the descriptors that existed before animation did.
		const graphics = [graphic('a', [shape('bar'), group('cluster', [text('name')])])];

		expect(model(graphics)).toEqual(model(graphics, {}));
		expect(model(graphics).graphics[0]?.style).toBeUndefined();
		expect(model(graphics).graphics[0]?.items[0]?.style.transform).toBeUndefined();
		expect(model(graphics).graphics[0]?.items[0]?.style.opacity).toBeUndefined();
	});

	it('rests a Broadcast Graphic that is not in the projection while another animates', () => {
		const graphics = [
			graphic('animating', [shape('bar', { animation: { enter: { ...LINEAR, fade: { opacity: 0 } } } })]),
			graphic('settled', [shape('bug', { animation: { enter: { ...LINEAR, fade: { opacity: 0 } } } })]),
		];

		const resolved = model(graphics, { animating: { phase: 'enter', elapsed: 0 } });

		expect(resolved.graphics[0]?.items[0]?.style.opacity).toBe(0);
		expect(resolved.graphics[1]?.items[0]?.style.opacity).toBeUndefined();
	});

	it('carries a whole-graphic recipe on the graphic own wrapper, so item fades compose multiplicatively', () => {
		const graphics = [{
			...graphic('a', [shape('bar', { animation: { enter: { ...LINEAR, fade: { opacity: 0 } } } })]),
			animation: { enter: { ...LINEAR, fade: { opacity: 0 } } },
		}];

		const resolved = model(graphics, { a: { phase: 'enter', elapsed: 200 } });

		// Each is half way, and they nest, so the composed result is 0.25 without
		// either of them having to know the other exists.
		expect(resolved.graphics[0]?.style?.opacity).toBe(0.5);
		expect(resolved.graphics[0]?.items[0]?.style.opacity).toBe(0.5);
	});

	it('slides an item in canvas pixels from its Graphic Resting State position', () => {
		const graphics = [graphic('a', [shape('bar', {
			animation: { enter: { ...LINEAR, slide: { direction: 'north', distanceMode: 'fixed', distance: 100 } } },
		})])];

		const start = model(graphics, { a: { phase: 'enter', elapsed: 0 } }).graphics[0]?.items[0];
		const settled = model(graphics, { a: { phase: 'enter', elapsed: 400 } }).graphics[0]?.items[0];

		expect(start?.style.transform).toBe('translate(0px, -100px)');
		// The resting position is unchanged: motion is a transform, never a rewrite
		// of the authored rectangle.
		expect(start?.style.left).toBe('10px');
		expect(start?.style.top).toBe('20px');
		expect(settled?.style.transform).toBeUndefined();
	});

	it('scales about its Graphic Animation Origin while rotating about its Graphic Anchor Point', () => {
		const graphics = [graphic('a', [shape('bar', {
			anchor: 'top-left',
			rotation: 30,
			animation: { enter: { ...LINEAR, scale: { factor: 0.5, origin: 'center' } } },
		})])];

		const item = model(graphics, { a: { phase: 'enter', elapsed: 0 } }).graphics[0]?.items[0];

		// One transform, one origin: the rotation is about the anchor, and the scale
		// reaches the centre origin by translating (1-s)(O-A) inside that rotation.
		expect(item?.style.transform).toBe('rotate(30deg) translate(75px, 25px) scale(0.5)');
		expect(item?.style.transformOrigin).toBe('0% 0%');
	});

	it('applies a slide outside the authored rotation and a scale inside it', () => {
		const graphics = [graphic('a', [shape('bar', {
			rotation: 45,
			animation: {
				enter: {
					...LINEAR,
					slide: { direction: 'east', distanceMode: 'fixed', distance: 60 },
					scale: { factor: 0, origin: 'top-left' },
				},
			},
		})])];

		const item = model(graphics, { a: { phase: 'enter', elapsed: 0 } }).graphics[0]?.items[0];

		// A slide is a canvas-space offset, so it must not be rotated by the item's
		// own Graphic Rotation; a scale is in the item's own frame, so it must be.
		expect(item?.style.transform).toBe('translate(60px, 0px) rotate(45deg) scale(0)');
	});

	it('wipes a reveal as a mask, so an existing Shape Geometry clip survives it', () => {
		const clipped = group('cluster', [text('name')], {
			clip: true,
			geometry: { ...squareShapeGeometry(), topRight: { treatment: 'cut', size: 24 } },
			animation: { enter: { ...LINEAR, reveal: { edge: 'left' } } },
		});

		const item = model([graphic('a', [clipped])], { a: { phase: 'enter', elapsed: 200 } }).graphics[0]?.items[0];

		expect(item?.style.maskImage).toBe('linear-gradient(to right, #ffffff 0 50%, #ffffff00 50%)');
		// The group's own Shape Geometry clip is still there: a wipe composes with
		// clipping rather than replacing it.
		expect(String(item?.style.clipPath)).toContain('path(');
	});

	it('wipes from each of the four edges towards the opposite one', () => {
		const edges = { left: 'to right', right: 'to left', top: 'to bottom', bottom: 'to top' } as const;

		for (const [edge, direction] of Object.entries(edges)) {
			const graphics = [graphic('a', [shape('bar', {
				animation: { enter: { ...LINEAR, reveal: { edge: edge as 'left' } } },
			})])];
			const item = model(graphics, { a: { phase: 'enter', elapsed: 0 } }).graphics[0]?.items[0];

			expect(item?.style.maskImage).toBe(`linear-gradient(${direction}, #ffffff 0 0%, #ffffff00 0%)`);
		}
	});

	it('drops the mask once a reveal is fully open, rather than emitting an inert one', () => {
		const graphics = [graphic('a', [shape('bar', {
			animation: { enter: { ...LINEAR, reveal: { edge: 'left' } } },
		})])];

		expect(model(graphics, { a: { phase: 'enter', elapsed: 400 } }).graphics[0]?.items[0]?.style.maskImage)
			.toBeUndefined();
	});

	it('staggers a selected subset of direct items in list order from one shared phase start', () => {
		const graphics = [{
			...graphic('a', [
				shape('first', { animation: { enter: { ...LINEAR, fade: { opacity: 0 } } } }),
				shape('second', { animation: { enter: { ...LINEAR, fade: { opacity: 0 } } } }),
				shape('third', { animation: { enter: { ...LINEAR, fade: { opacity: 0 } } } }),
			]),
			animation: { stagger: { enter: { order: 'list' as const, step: 400, itemIds: ['first', 'third'] } } },
		}];

		const items = model(graphics, { a: { phase: 'enter', elapsed: 400 } }).graphics[0]?.items ?? [];

		// `first` has finished, `second` is not staggered so it has finished too, and
		// `third` is only now starting its own 400ms travel.
		expect(items[0]?.style.opacity).toBeUndefined();
		expect(items[1]?.style.opacity).toBeUndefined();
		expect(items[2]?.style.opacity).toBe(0);
	});

	it('reverses a stagger for an exit without touching the enter order', () => {
		const items = [
			shape('first', { animation: { exit: { ...LINEAR, fade: { opacity: 0 } } } }),
			shape('second', { animation: { exit: { ...LINEAR, fade: { opacity: 0 } } } }),
		];
		const graphics = [{
			...graphic('a', items),
			animation: { stagger: { exit: { order: 'reverse-list' as const, step: 400, itemIds: ['first', 'second'] } } },
		}];

		const resolved = model(graphics, { a: { phase: 'exit', elapsed: 400 } }).graphics[0]?.items ?? [];

		// Reverse-list: `second` leads and has finished fading out, while `first` has
		// not begun and so is still exactly at its Graphic Resting State.
		expect(resolved[0]?.style.opacity).toBeUndefined();
		expect(resolved[1]?.style.opacity).toBe(0);
	});

	it('adds a Graphic Group stagger on top of the offset the group itself received', () => {
		const graphics = [{
			...graphic('a', [
				shape('bed'),
				group('cluster', [
					text('one', { animation: { enter: { ...LINEAR, fade: { opacity: 0 } } } }),
					text('two', { animation: { enter: { ...LINEAR, fade: { opacity: 0 } } } }),
				], {
					animation: { stagger: { enter: { order: 'list', step: 400, itemIds: ['one', 'two'] } } },
				}),
			]),
			animation: { stagger: { enter: { order: 'list' as const, step: 400, itemIds: ['bed', 'cluster'] } } },
		}];

		const children = model(graphics, { a: { phase: 'enter', elapsed: 800 } }).graphics[0]?.items[1]?.children ?? [];

		// `cluster` is second in the graphic's stagger (400), `two` second in its
		// group's (another 400), so at 800ms it is only just beginning.
		expect(children[0]?.style.opacity).toBeUndefined();
		expect(children[1]?.style.opacity).toBe(0);
	});

	it('clears the Graphic Group, not the canvas, for a child sliding past its parent', () => {
		const graphics = [graphic('a', [group('cluster', [text('name', {
			x: 0,
			width: 100,
			animation: { exit: { ...LINEAR, slide: { direction: 'east', distanceMode: 'clear-parent', distance: 0 } } },
		})], { arrangement: 'canvas', width: 600 })])];

		const child = model(graphics, { a: { phase: 'exit', elapsed: 400 } }).graphics[0]?.items[0]?.children?.[0];

		// The group is 600 wide and the child sits at its left edge, so clearing the
		// group is 600 — not the 1920 it would take to clear the Screen canvas.
		expect(child?.style.transform).toBe('translate(600px, 0px)');
	});

	it('animates a row or column Graphic Group child, which has no Graphic Rotation of its own', () => {
		const graphics = [graphic('a', [group('cluster', [text('name', {
			animation: { enter: { ...LINEAR, scale: { factor: 0.5, origin: 'center' }, fade: { opacity: 0 } } },
		})], { arrangement: 'row' })])];

		const child = model(graphics, { a: { phase: 'enter', elapsed: 0 } }).graphics[0]?.items[0]?.children?.[0];

		expect(child?.style.opacity).toBe(0);
		expect(String(child?.style.transform)).toContain('scale(0.5)');
		expect(String(child?.style.transform)).not.toContain('rotate');
	});

	it('resolves the same composition and animation phase in the Overlay, Fill, and Key Outputs', () => {
		// At the same authoritative time every output has to agree, so the motion each
		// one resolves must be identical even though what they paint differs.
		const graphics = [{
			...graphic('a', [shape('bar', {
				animation: {
					enter: {
						...LINEAR,
						fade: { opacity: 0 },
						slide: { direction: 'south', distanceMode: 'fixed', distance: 40 },
						scale: { factor: 0.8, origin: 'bottom-right' },
						reveal: { edge: 'top' },
					},
				},
			})]),
			animation: { enter: { ...LINEAR, fade: { opacity: 0.2 } } },
		}];
		const at = { a: { phase: 'enter' as const, elapsed: 137 } };

		const motion = (output: 'overlay' | 'fill' | 'key') => {
			const resolved = model(graphics, at, output);
			const item = resolved.graphics[0]!.items[0]!.style;
			return {
				graphic: resolved.graphics[0]!.style,
				transform: item.transform,
				transformOrigin: item.transformOrigin,
				opacity: item.opacity,
				maskImage: item.maskImage,
			};
		};

		expect(motion('fill')).toEqual(motion('overlay'));
		expect(motion('key')).toEqual(motion('overlay'));
	});

	it('is deterministic: one elapsed time always produces one frame', () => {
		const graphics = [graphic('a', [shape('bar', {
			animation: { enter: { duration: 700, easing: 'back-out', delay: 120, scale: { factor: 0.4, origin: 'top' } } },
		})])];
		const at = { a: { phase: 'enter' as const, elapsed: 333 } };

		expect(model(graphics, at)).toEqual(model(graphics, at));
	});

	describe('the Key Output alpha matte survives animation', () => {
		const animated = {
			...graphic('a', [
				shape('bar', {
					surfaceStyle: surfaceStyle({ fillOpacity: 0.5, outline: { color: '#00d9ff', width: 4 }, glow: { color: '#ff51c7', size: 20, opacity: 0.5 } }),
					rotation: 12,
					animation: {
						enter: {
							duration: 400,
							easing: 'ease-out',
							delay: 0,
							fade: { opacity: 0.1 },
							slide: { direction: 'north-west', distanceMode: 'clear-parent', distance: 0 },
							scale: { factor: 1.8, origin: 'bottom-left' },
							reveal: { edge: 'bottom' },
						},
					},
				}),
				group('cluster', [text('name', {
					surfaceStyle: surfaceStyle({ fillOpacity: 0.75 }),
					animation: { enter: { duration: 400, easing: 'linear', delay: 0, reveal: { edge: 'right' }, fade: { opacity: 0 } } },
				})], {
					clip: true,
					surfaceStyle: surfaceStyle(),
					animation: { enter: { duration: 400, easing: 'linear', delay: 0, scale: { factor: 0.2, origin: 'center' } } },
				}),
			]),
			animation: {
				enter: { duration: 400, easing: 'linear' as const, delay: 0, fade: { opacity: 0 }, scale: { factor: 0.5, origin: 'center' as const } },
				stagger: { enter: { order: 'list' as const, step: 50, itemIds: ['bar', 'cluster'] } },
			},
		};

		it('paints nothing the matte identity does not allow, at any point in a phase', () => {
			for (const elapsed of [0, 25, 50, 137, 200, 399, 400, 4000]) {
				const resolved = model([animated], { a: { phase: 'enter', elapsed } }, 'key');

				expect(() => graphicPaints(resolved.graphics[0]!)).not.toThrow();
			}
		});

		it('still accumulates the alpha union of two overlapping half-opaque items', () => {
			// The identity the Key Output is built on, re-checked with motion applied:
			// animation contributes transforms, an opacity factor, and a stencil, none
			// of which add paint, so the composed luminance is unchanged.
			const alphas = [0.5, 0.5];
			const graphics = [graphic('a', alphas.map((fillOpacity, index) => shape(`item-${index}`, {
				surfaceStyle: surfaceStyle({ fill: { type: 'solid', color: '#123456' }, fillOpacity }),
				animation: { enter: { duration: 400, easing: 'linear', delay: 0, slide: { direction: 'south', distanceMode: 'fixed', distance: 10 }, reveal: { edge: 'left' } } },
			})))];

			const resolved = model(graphics, { a: { phase: 'enter', elapsed: 200 } }, 'key');
			const luminance = compositeKeyLuminance(
				resolved.canvasStyle.background,
				resolved.graphics[0]!.items.flatMap(item => itemPaints(item)),
			);

			expect(luminance).toBeCloseTo(0.75, 2);
		});

		it('fails closed on a mask that is not exactly one white wipe', () => {
			const probe = (style: CSSProperties): GraphicItemRenderDescriptor => ({
				id: 'probe',
				label: 'probe',
				kind: 'shape',
				style,
			});

			for (const maskImage of [
				'linear-gradient(to right, #000000 0 50%, transparent 50%)',
				'linear-gradient(to right, black 0 50%, #ffffff00 50%)',
				'linear-gradient(45deg, #ffffff 0 50%, #ffffff00 50%)',
				'url(#wipe)',
				'linear-gradient(to right, #ffffff 0 50%, #ffffff00 50%), linear-gradient(to top, #ffffff 0 10%, #ffffff00 10%)',
			])
				expect(() => itemPaints(probe({ maskImage }))).toThrow(/maskImage must be exactly one white wipe/);

			expect(() => itemPaints(probe({ maskImage: 'linear-gradient(to top, #ffffff 0 12.5%, #ffffff00 12.5%)' })))
				.not
				.toThrow();
		});

		it('fails closed on an animation property nothing here has vetted', () => {
			const probe = (style: CSSProperties): GraphicItemRenderDescriptor => ({
				id: 'probe',
				label: 'probe',
				kind: 'shape',
				style,
			});

			// Every one of these is a plausible way a later animation change could
			// reach for paint or for compositing the matte identity forbids.
			expect(() => itemPaints(probe({ mixBlendMode: 'screen' }))).toThrow(/unrecognised style property/);
			expect(() => itemPaints(probe({ animation: 'wipe 1s linear' }))).toThrow(/unrecognised style property/);
			expect(() => itemPaints(probe({ transition: 'opacity 300ms linear' }))).toThrow(/unrecognised style property/);
			expect(() => itemPaints(probe({ backdropFilter: 'blur(4px)' }))).toThrow(/unrecognised style property/);
			expect(() => itemPaints(probe({ WebkitMaskImage: 'linear-gradient(to right, red, blue)' })))
				.toThrow(/unrecognised style property/);
		});
	});
});
