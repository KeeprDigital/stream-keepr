import type { CSSProperties } from 'vue';
import type {
	GraphicItemRenderDescriptor,
	GraphicMediaRenderDescriptor,
	GraphicSurfaceRenderDescriptor,
} from '~/modules/graphics/renderModel';

/**
 * A Key Output guard for render models: every colour a descriptor paints, with
 * proof that it paints nothing else. It is closed rather than open: a style key
 * not known to be non-painting fails whatever its value, so a later `background`
 * or `boxShadow` is caught by its key alone. Written from the compositing rule,
 * not from the module under test.
 */

export interface KeyPaint {
	color: string;
	opacity: number;
}

const WHITE = /^#ffffff(?:[\da-f]{2})?$/i;

/** The one filter a painted surface may carry: a white glow. */
const WHITE_GLOW = /^drop-shadow\(0 0 [\d.]+px (#ffffff[\da-f]{2})\)$/i;

/** Anything that could be a colour; a false positive fails loudly, which is the safe direction. */
const COLOUR_TOKEN = /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\([^)]*\)|\b(?:red|green|blue|black|cyan|magenta|yellow|orange|purple|pink|brown|gray|grey|silver|gold|teal|navy|olive|lime|aqua|fuchsia|maroon|rebeccapurple|currentcolor)\b/gi;

const RECOGNISED_COLOUR_KEYS = new Set(['color']);

/** The alpha-as-white conversion an image or video must carry, written out independently of the module. */
export const KEY_MEDIA_ALPHA_TO_WHITE = 'brightness(0) invert(1)';

/** Every style property the render model emits that cannot paint. Adding one is the moment to ask whether it paints. */
const NON_PAINTING_KEYS = new Set([
	'alignContent',
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
	'gridAutoRows',
	'gridTemplateColumns',
	'height',
	'inset',
	'justifyContent',
	'left',
	'letterSpacing',
	'lineHeight',
	'margin',
	'minHeight',
	'minWidth',
	// Scales an element's own alpha, so it multiplies through the matte rather than painting.
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
	'WebkitBoxOrient',
	'WebkitLineClamp',
	'whiteSpace',
	'width',
]);

/** Replaced-element properties, meaningless anywhere but on media. */
const MEDIA_NON_PAINTING_KEYS = new Set(['objectFit', 'objectPosition']);

/** The one mask the Key Output may carry: a hard-edged white wipe, a stencil rather than paint. */
const WHITE_WIPE_MASK = /^linear-gradient\(to (?:right|left|bottom|top), #ffffff 0 [\d.]+%, #ffffff00 [\d.]+%\)$/i;

export function keyChannels(value: string): { luminance: number; alpha: number } {
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
		alpha: hex[2] === undefined
			? 1
			: Number.parseInt(hex[2], 16) / 255,
	};
}

/**
 * Source-over of each paint onto the backdrop, `C_out = C_src * a_src + C_dst * (1 - a_src)`.
 * Returns the luminance, which for a Key Output is the composed alpha; a non-white fill or
 * non-black backdrop makes it diverge from the alpha union.
 */
export function compositeKeyLuminance(backdrop: unknown, paints: KeyPaint[]): number {
	const base = keyChannels(String(backdrop ?? ''));
	return paints.reduce<number>((destination, paint) => {
		const source = keyChannels(paint.color);
		const alpha = source.alpha * paint.opacity;
		return (source.luminance * alpha) + (destination * (1 - alpha));
	}, base.luminance * base.alpha);
}

export function stylePaints(style: CSSProperties, path: string): KeyPaint[] {
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

/** An image cannot be recoloured by CSS, so it must carry the alpha-as-white conversion; an unresolved one paints nothing. */
function replacedElementPaints(element: { src: string; style: CSSProperties }, path: string, opacity: number): KeyPaint[] {
	for (const [key, value] of Object.entries(element.style)) {
		if (value === undefined || value === null)
			continue;
		const text = String(value);

		if (key === 'filter') {
			if (text !== KEY_MEDIA_ALPHA_TO_WHITE)
				throw new Error(`${path}.filter must be exactly the alpha-as-white conversion, got: ${text}`);
			continue;
		}

		if (!MEDIA_NON_PAINTING_KEYS.has(key) && !NON_PAINTING_KEYS.has(key))
			throw new Error(`${path}.${key} is an unrecognised style property in the Key Output: ${text}`);
		if ((text.match(COLOUR_TOKEN) ?? []).length > 0)
			throw new Error(`${path}.${key} is an unrecognised paint in the Key Output: ${text}`);
	}

	if (element.src === '')
		return [];
	if (element.style.filter !== KEY_MEDIA_ALPHA_TO_WHITE)
		throw new Error(`${path} paints its own colours into the Key Output instead of its alpha as white`);
	return [
		{ color: '#ffffff', opacity },
	];
}

function mediaPaints(media: GraphicMediaRenderDescriptor, path: string): KeyPaint[] {
	return replacedElementPaints(media, `${path}.media`, Number(media.style.opacity ?? 1));
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

/** Every colour one Graphic Item paints, in paint order, walking every painted subtree. */
export function itemPaints(item: GraphicItemRenderDescriptor, prefix = ''): KeyPaint[] {
	const path = `${prefix}${item.id}`;

	return [
		...stylePaints(item.style, path),
		...(item.textStyle
			? stylePaints(item.textStyle, `${path}.textStyle`)
			: []),
		...(item.textSegments ?? []).flatMap((segment, index) =>
			segment.style
				? stylePaints(segment.style, `${path}.textSegments[${index}]`)
				: []),
		...(item.surface
			? surfacePaints(item.surface, path)
			: []),
		...(item.media
			? mediaPaints(item.media, path)
			: []),
		...(item.icon
			? stylePaints(item.icon.style, `${path}.icon`)
			: []),
		...(item.deckList?.cards ?? []).flatMap((card, index) => [
			...stylePaints(card.style, `${path}.deckList[${index}]`),
			...(card.image
				? replacedElementPaints(card.image, `${path}.deckList[${index}].image`, 1)
				: []),
			...(card.placeholder
				? [
						...surfacePaints(card.placeholder.surface, `${path}.deckList[${index}].placeholder`),
						...stylePaints(card.placeholder.textStyle, `${path}.deckList[${index}].placeholder.text`),
					]
				: []),
			...(card.badge
				? stylePaints(card.badge.style, `${path}.deckList[${index}].badge`)
				: []),
		]),
		...(item.children ?? []).flatMap(child => itemPaints(child, `${path}>`)),
		...(item.crossTransition
			? [
					...itemPaints(item.crossTransition.outgoing, `${path}~outgoing>`),
					...itemPaints(item.crossTransition.incoming, `${path}~incoming>`),
				]
			: []),
		...(item.enclosed
			? itemPaints(item.enclosed, `${path}~enclosed>`)
			: []),
	];
}

/** Every colour one composed Broadcast Graphic paints, its own wrappers and outgoing frame included. */
export function graphicPaints(graphic: {
	id: string;
	style?: CSSProperties;
	enclosingStyle?: CSSProperties;
	items: GraphicItemRenderDescriptor[];
	outgoing?: { style?: CSSProperties; items: GraphicItemRenderDescriptor[] };
}): KeyPaint[] {
	return [
		...(graphic.enclosingStyle
			? stylePaints(graphic.enclosingStyle, `${graphic.id}.enclosingStyle`)
			: []),
		...(graphic.style
			? stylePaints(graphic.style, `${graphic.id}.style`)
			: []),
		...graphic.items.flatMap(item => itemPaints(item, `${graphic.id}>`)),
		...(graphic.outgoing?.style
			? stylePaints(graphic.outgoing.style, `${graphic.id}.outgoing.style`)
			: []),
		...(graphic.outgoing?.items ?? []).flatMap(item => itemPaints(item, `${graphic.id}~outgoing>`)),
	];
}
