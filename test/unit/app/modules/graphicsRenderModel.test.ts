import type { BroadcastGraphicConfig, ShapeGraphicItemConfig, TextGraphicItemConfig } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import { DEFAULT_GRAPHIC_TYPOGRAPHY } from '~~/shared/modules/graphics';
import { resolveGraphicsCompositionRenderModel } from '~/modules/graphics/renderModel';

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
		geometry: { cornerRadius: 12 },
		surfaceStyle: { fill: '#0077a3', fillOpacity: 0.5 },
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
function compositeKeyLuminance(backdrop: unknown, paints: unknown[]): number {
	function channels(value: unknown): { luminance: number; alpha: number } {
		const hex = /^#([\da-f]{6})([\da-f]{2})?$/i.exec(String(value ?? ''));
		if (!hex)
			throw new Error(`Key Output painted a colour this compositor cannot read: ${String(value)}`);
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

	const base = channels(backdrop);
	return paints.reduce<number>((destination, paint) => {
		const source = channels(paint);
		return (source.luminance * source.alpha) + (destination * (1 - source.alpha));
	}, base.luminance * base.alpha);
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

	it('omits a hidden Graphic Item from the composed frame', () => {
		const model = resolveGraphicsCompositionRenderModel({
			output: 'overlay',
			graphics: [graphic('a', [shape('shown'), shape('hidden', { visible: false })])],
			...CANVAS,
		});

		expect(model.graphics[0]?.items.map(item => item.id)).toEqual(['shown']);
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

	it('renders a Shape Graphic Item fill with its authored opacity and Shape Geometry corner radius', () => {
		const model = resolveGraphicsCompositionRenderModel({
			output: 'overlay',
			graphics: [graphic('a', [shape('bar')])],
			...CANVAS,
		});

		expect(model.graphics[0]?.items[0]?.style).toMatchObject({
			background: 'rgba(0, 119, 163, 0.5)',
			borderRadius: '12px',
		});
	});

	it('derives the Key Output as a grayscale alpha matte of the composed opacity', () => {
		const model = resolveGraphicsCompositionRenderModel({
			output: 'key',
			graphics: [graphic('a', [shape('bar'), text('name')])],
			...CANVAS,
		});

		expect(model.graphics[0]?.items[0]?.style.background).toBe('#ffffff80');
		expect(model.graphics[0]?.items[1]?.textStyle?.color).toBe('#ffffff');
	});

	it('accumulates overlapping Graphic Items into their true combined alpha in the Key Output', () => {
		// Two half-opaque items over the same bounds. Their true combined alpha is
		// the alpha union 1 - (1 - a1)(1 - a2) = 0.75, independent of this module.
		const model = resolveGraphicsCompositionRenderModel({
			output: 'key',
			graphics: [graphic('a', [
				shape('under', { surfaceStyle: { fill: '#0077a3', fillOpacity: 0.5 } }),
				shape('over', { surfaceStyle: { fill: '#ff0000', fillOpacity: 0.5 } }),
			])],
			...CANVAS,
		});

		const luminance = compositeKeyLuminance(
			model.canvasStyle.background,
			model.graphics[0]!.items.map(item => item.style.background),
		);

		// 8-bit alpha quantisation puts 0.5 at 128/255, so compare to 2 decimals.
		expect(luminance).toBeCloseTo(0.75, 2);
	});

	it('holds the Key Output matte for a stack of many overlapping Graphic Items', () => {
		const alphas = [0.25, 0.5, 0.75, 0.5];
		const model = resolveGraphicsCompositionRenderModel({
			output: 'key',
			graphics: [graphic('a', alphas.map((fillOpacity, index) =>
				shape(`item-${index}`, { surfaceStyle: { fill: '#123456', fillOpacity } }),
			))],
			...CANVAS,
		});

		const expectedUnion = 1 - alphas.reduce((remaining, alpha) => remaining * (1 - alpha), 1);
		const luminance = compositeKeyLuminance(
			model.canvasStyle.background,
			model.graphics[0]!.items.map(item => item.style.background),
		);

		expect(luminance).toBeCloseTo(expectedUnion, 2);
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
});
