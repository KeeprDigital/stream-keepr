/**
 * The browser half of the Key matte rendering proof, bundled by esbuild from the
 * application's own render models (see `key-matte-proof.mjs`).
 *
 * The page draws each scene in one output at a time from exactly the descriptors
 * a Screen Output draws — the shared compositor's for a Graphic Item, the Feature
 * Match Overlay's for a Source Item and the Frame — and measures two screenshots
 * the Node half takes of it: the Overlay Output over transparency and the Key
 * Output over black. It publishes counts; it judges nothing.
 *
 * The DOM here is the components' DOM written out by hand, element for element:
 * `Graphics/Compositor/Item.vue` for a surface and the Feature Match Overlay
 * `Display.vue` for the Source Item and Frame. What the proof stands on is the
 * render models' paint — colour, opacity, filter — rasterised by Chromium.
 */

import { squareShapeGeometry } from '~~/shared/modules/graphics';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';
import { frameBorderLine, resolveFeatureMatchOverlayRenderModel } from '~/modules/feature-match-overlay/renderModel';
import { resolveGraphicsCompositionRenderModel } from '~/modules/graphics/renderModel';
import { KEY_MATTE_PROOF_SCENE, KEY_MATTE_PROOF_SCENES } from './key-matte-scenarios.mjs';

const SVG = 'http://www.w3.org/2000/svg';
const { width: SCENE_WIDTH, height: SCENE_HEIGHT } = KEY_MATTE_PROOF_SCENE;

/** A half-opaque glow in a colour that is not white, so colour reaching the Key Output shows. */
const GLOW = { color: '#ff51c7', size: 16, opacity: 0.5 };

function element(tag, style = {}, attributes = {}) {
	const node = tag === 'div'
		? document.createElement('div')
		: document.createElementNS(SVG, tag);
	Object.assign(node.style, style);
	for (const [name, value] of Object.entries(attributes)) {
		if (value !== undefined)
			node.setAttribute(name, String(value));
	}
	return node;
}

function featureMatchOverlayModel(output, layout) {
	const base = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
	return resolveFeatureMatchOverlayRenderModel({
		config: {
			...base,
			layout: {
				...base.layout,
				...layout,
			},
		},
		output,
		maskId: `key-matte-mask-${output}`,
		frameGlowFilterId: `key-matte-glow-${output}`,
	});
}

/** A Shape Graphic Item with an opaque fill and a half-opaque glow, through the shared compositor. */
function drawGraphicItem(stage, output) {
	const model = resolveGraphicsCompositionRenderModel({
		output,
		canvasWidth: SCENE_WIDTH,
		canvasHeight: SCENE_HEIGHT,
		graphics: [
			{
				id: 'proof',
				name: 'proof',
				items: [
					{
						type: 'shape',
						id: 'lit',
						label: 'lit',
						visible: true,
						anchor: 'top-left',
						x: 60,
						y: 50,
						width: 120,
						height: 60,
						geometry: squareShapeGeometry(),
						surfaceStyle: {
							fill: { type: 'solid', color: '#0077a3' },
							fillOpacity: 1,
							glow: GLOW,
						},
					},
				],
			},
		],
	});
	stage.style.background = model.canvasStyle.background;
	for (const graphic of model.graphics) {
		const layer = element('div', { position: 'absolute', inset: '0', ...graphic.style });
		for (const item of graphic.items) {
			const box = element('div', { position: 'absolute', ...item.style });
			const { surface } = item;
			if (surface) {
				const svg = element('svg', {
					position: 'absolute',
					inset: '0',
					width: '100%',
					height: '100%',
					overflow: 'visible',
				}, {
					viewBox: `0 0 ${surface.width} ${surface.height}`,
					preserveAspectRatio: 'none',
				});
				svg.append(element('path', {}, { 'd': surface.path, 'fill': surface.fill.color, 'fill-opacity': surface.fill.opacity }));
				box.append(svg);
			}
			layer.append(box);
		}
		stage.append(layer);
	}
}

/** A Source Item with a border and a half-opaque glow, as the Feature Match Overlay Display draws it. */
function drawSourceItem(stage, output, { unkeyed = false } = {}) {
	const model = featureMatchOverlayModel(output, {
		frame: { backgroundColor: '#101820', opacity: 0 },
		sources: [
			{
				id: 'source',
				label: 'Source',
				visible: true,
				x: 60,
				y: 50,
				width: 120,
				height: 60,
				sourceRole: 'main',
				frameCutout: false,
				framingStyle: {
					borderVisible: true,
					borderColor: '#0077a3',
					borderWidth: 4,
					glowColor: GLOW.color,
					glowSize: GLOW.size,
					glowOpacity: GLOW.opacity,
				},
			},
		],
	});
	stage.style.background = model.canvasStyle.background;
	for (const source of model.sourceItems) {
		// The planted control: the Key Output as it was before #599, glow withheld.
		const glows = !(unkeyed && output === 'key');
		if (glows && source.glowContainerStyle && source.glowStyle) {
			const container = element('div', source.glowContainerStyle);
			container.append(element('div', source.glowStyle));
			stage.append(container);
		}
		stage.append(element('div', source.style));
	}
}

/** The Frame's border with a half-opaque glow, its own fill at zero opacity so only the border paints. */
function drawFrame(stage, output) {
	const model = featureMatchOverlayModel(output, {
		frame: {
			backgroundColor: '#101820',
			opacity: 0,
			borderVisible: true,
			borderColor: '#0077a3',
			borderWidth: 8,
			glowColor: GLOW.color,
			glowSize: GLOW.size,
			glowOpacity: GLOW.opacity,
		},
		sources: [],
	});
	stage.style.background = model.canvasStyle.background;
	const { frame } = model;
	const svg = element('svg', { position: 'absolute', inset: '0' }, {
		width: '100%',
		height: '100%',
		viewBox: `0 0 ${SCENE_WIDTH} ${SCENE_HEIGHT}`,
		preserveAspectRatio: 'none',
	});
	const defs = element('defs');
	const glow = frame.border?.glow;
	if (glow) {
		const filter = element('filter', {}, {
			id: glow.filterId,
			x: '-20%',
			y: '-20%',
			width: '140%',
			height: '140%',
		});
		filter.append(element('feDropShadow', {}, {
			'dx': 0,
			'dy': 0,
			'stdDeviation': glow.stdDeviation,
			'flood-color': glow.floodColor,
			'flood-opacity': glow.floodOpacity,
		}));
		defs.append(filter);
	}
	svg.append(defs);
	svg.append(element('rect', {}, {
		x: 0,
		y: 0,
		width: SCENE_WIDTH,
		height: SCENE_HEIGHT,
		fill: frame.fill,
		opacity: frame.opacity,
	}));
	if (frame.border) {
		const group = element('g', {}, {
			'stroke': frame.border.stroke,
			'stroke-width': frame.border.strokeWidth,
			'filter': glow
				? `url(#${glow.filterId})`
				: undefined,
		});
		for (const side of frame.border.sides)
			group.append(element('line', {}, frameBorderLine(side, SCENE_WIDTH, SCENE_HEIGHT)));
		svg.append(group);
	}
	stage.append(svg);
}

const DRAW = {
	'graphic-item-glow': drawGraphicItem,
	'source-item-glow': drawSourceItem,
	'frame-glow': drawFrame,
	'unkeyed-glow-control': (stage, output) => drawSourceItem(stage, output, { unkeyed: true }),
};

function nextFrame() {
	return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

/** Draw every scene in one output, and settle once Chromium has painted it. */
async function render(output) {
	const root = document.getElementById('scenes');
	root.replaceChildren();
	for (const [index, name] of KEY_MATTE_PROOF_SCENES.entries()) {
		const stage = element('div', {
			position: 'absolute',
			left: `${index * SCENE_WIDTH}px`,
			top: '0',
			width: `${SCENE_WIDTH}px`,
			height: `${SCENE_HEIGHT}px`,
			overflow: 'hidden',
			isolation: 'isolate',
		});
		stage.dataset.scene = name;
		DRAW[name](stage, output);
		root.append(stage);
	}
	await nextFrame();
	await nextFrame();
	return output;
}

async function pixels(png) {
	const blob = await (await fetch(`data:image/png;base64,${png}`)).blob();
	const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
	const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
	const context = canvas.getContext('2d', { willReadFrequently: true });
	context.drawImage(bitmap, 0, 0);
	return { width: bitmap.width, data: context.getImageData(0, 0, bitmap.width, bitmap.height).data };
}

/**
 * Per scene: how far the Key Output's luminance strays from the Overlay Output's
 * alpha, how many Key pixels are partial grey, and how far any Key pixel is from
 * grey at all. Values are in 0–255 units, so they read against a pixel.
 */
async function measure(overlayPng, keyPng) {
	const overlay = await pixels(overlayPng);
	const key = await pixels(keyPng);
	const scenes = KEY_MATTE_PROOF_SCENES.map((name, index) => {
		let maxMatteError = 0;
		let greyPixels = 0;
		let maxChroma = 0;
		for (let y = 0; y < SCENE_HEIGHT; y++) {
			for (let x = index * SCENE_WIDTH; x < (index + 1) * SCENE_WIDTH; x++) {
				const at = ((y * overlay.width) + x) * 4;
				const alpha = overlay.data[at + 3];
				const [r, g, b] = [key.data[at], key.data[at + 1], key.data[at + 2]];
				maxMatteError = Math.max(maxMatteError, Math.abs(r - alpha));
				maxChroma = Math.max(maxChroma, Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
				if (r > 0 && r < 255)
					greyPixels++;
			}
		}
		return {
			name,
			maxMatteError,
			greyPixels,
			maxChroma,
		};
	});
	return JSON.stringify({ scenes });
}

window.keyMatteProof = { render, measure };
document.body.dataset.ready = 'true';
