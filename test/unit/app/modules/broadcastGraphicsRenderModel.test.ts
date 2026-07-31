import type { BroadcastGraphicsRenderModelInput } from '~~/app/modules/broadcast-graphics/renderModel';
import type { BroadcastGraphicConfig, GraphicInputDeclaration, GraphicPlaceholderStyle } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import { resolveBroadcastGraphicsRenderModel } from '~~/app/modules/broadcast-graphics/renderModel';
import { squareShapeGeometry } from '~~/shared/modules/graphics';

function graphic(id: string): BroadcastGraphicConfig {
	return {
		id,
		name: id,
		items: [{
			type: 'shape',
			id: `${id}-shape`,
			label: 'Shape 1',
			visible: true,
			anchor: 'top-left',
			x: 0,
			y: 0,
			width: 100,
			height: 100,
			geometry: squareShapeGeometry(),
			surfaceStyle: { fill: { type: 'solid', color: '#ffffff' }, fillOpacity: 1 },
		}],
	};
}

function input(overrides: Partial<BroadcastGraphicsRenderModelInput> = {}): BroadcastGraphicsRenderModelInput {
	return {
		output: 'overlay',
		canvasWidth: 1920,
		canvasHeight: 1080,
		graphics: [],
		...overrides,
	};
}

const TEMPLATE_INPUTS: GraphicInputDeclaration[] = [
	{ type: 'text', key: 'name', label: 'Name', required: false, updatePolicy: 'staged', default: 'Unnamed', maxLength: 20 },
	{ type: 'text', key: 'title', label: 'Title', required: false, updatePolicy: 'staged', default: '', maxLength: 20 },
];

/** A Broadcast Graphic whose Text Graphic Item renders a Graphic Text Template. */
function templateGraphic(
	placeholderStyles: Record<string, GraphicPlaceholderStyle> = { title: { fontWeight: 300, fontSize: 24 } },
): BroadcastGraphicConfig {
	return {
		id: 'lower-third',
		name: 'Lower Third',
		inputs: TEMPLATE_INPUTS,
		items: [{
			type: 'text',
			id: 'name-line',
			label: 'Name line',
			visible: true,
			anchor: 'top-left',
			x: 0,
			y: 0,
			width: 600,
			height: 120,
			text: '{name} — {title}',
			typography: {
				fontId: 'inter',
				fontSize: 48,
				fontWeight: 700,
				fontStyle: 'normal',
				textTransform: 'none',
				letterSpacing: 0,
				lineHeight: 1.2,
				textAlign: 'left',
				color: '#ffffff',
			},
			overflowPolicy: 'ellipsis',
			minFontSize: 24,
			placeholderStyles,
		}],
	};
}

describe('broadcast Graphics render model', () => {
	it('renders an empty Broadcast Graphics Screen transparent in the Overlay Output', () => {
		const model = resolveBroadcastGraphicsRenderModel(input());

		expect(model.output).toBe('overlay');
		expect(model.canvasStyle.background).toBe('transparent');
	});

	it('renders an empty Broadcast Graphics Screen black in the Fill and Key Outputs', () => {
		expect(resolveBroadcastGraphicsRenderModel(input({ output: 'fill' })).canvasStyle.background).toBe('#000000');
		expect(resolveBroadcastGraphicsRenderModel(input({ output: 'key' })).canvasStyle.background).toBe('#000000');
	});

	it('gives the Overlay, Fill, and Key Outputs identical canvas dimensions', () => {
		const overlay = resolveBroadcastGraphicsRenderModel(input()).canvasStyle;
		const fill = resolveBroadcastGraphicsRenderModel(input({ output: 'fill' })).canvasStyle;
		const key = resolveBroadcastGraphicsRenderModel(input({ output: 'key' })).canvasStyle;

		expect([overlay.width, overlay.height]).toEqual(['100%', '100%']);
		expect([fill.width, fill.height]).toEqual([overlay.width, overlay.height]);
		expect([key.width, key.height]).toEqual([overlay.width, overlay.height]);
	});

	it('clips the canvas to its Screen so nothing renders outside the composed frame', () => {
		expect(resolveBroadcastGraphicsRenderModel(input()).canvasStyle).toMatchObject({
			position: 'relative',
			overflow: 'hidden',
		});
	});

	it('renders an authored but off-air Broadcast Graphic on no Screen Output', () => {
		const model = resolveBroadcastGraphicsRenderModel(input({ graphics: [graphic('lower-third')] }));

		expect(model.graphics).toEqual([]);
	});

	it('composes only the on-air Broadcast Graphics, in authored Screen stack order', () => {
		const model = resolveBroadcastGraphicsRenderModel(input({
			graphics: [graphic('back'), graphic('middle'), graphic('front')],
			onAirGraphicIds: ['front', 'back'],
		}));

		expect(model.graphics.map(entry => entry.id)).toEqual(['back', 'front']);
	});

	it('composes concurrent Broadcast Graphics in authored stack order whatever their Graphic Channel', () => {
		// Channel membership is a playout relationship, not a compositing one. The
		// composition is derived from the authored stack and a membership set, so a
		// channel member interleaved between two graphics in no channel — and taken last
		// — still composites exactly where it was authored.
		const model = resolveBroadcastGraphicsRenderModel(input({
			graphics: [
				graphic('back'),
				{ ...graphic('middle'), channelId: 'thirds' },
				{ ...graphic('front'), channelId: 'slates' },
			],
			onAirGraphicIds: ['middle', 'front', 'back'],
		}));

		expect(model.graphics.map(entry => entry.id)).toEqual(['back', 'middle', 'front']);
	});

	it('keeps advisory guides out of a Screen Output that does not ask for them', () => {
		const model = resolveBroadcastGraphicsRenderModel(input({
			graphics: [graphic('lower-third')],
			onAirGraphicIds: ['lower-third'],
		}));

		expect(model.safeAreaGuides).toEqual([]);
		expect(model.itemGuides).toEqual([]);
	});

	it('renders a Graphic Text Template from the accepted on-air Graphic Input values', () => {
		const model = resolveBroadcastGraphicsRenderModel(input({
			graphics: [templateGraphic()],
			onAirGraphicIds: ['lower-third'],
			inputValues: { 'lower-third': { name: 'Ava Reed', title: 'Champion' } },
		}));

		expect(model.graphics[0]!.items[0]!.text).toBe('Ava Reed — Champion');
	});

	it('renders declared defaults for an authoring preview, which has nothing accepted', () => {
		// An editor preview composes the authored stack with no playout behind it, so an
		// author sees the design as they authored it.
		const model = resolveBroadcastGraphicsRenderModel(input({
			graphics: [templateGraphic()],
			onAirGraphicIds: ['lower-third'],
			substituteAuthoredDefaults: true,
		}));

		expect(model.graphics[0]!.items[0]!.text).toBe('Unnamed — ');
	});

	it('renders nothing for an unset Graphic Input on a live output', () => {
		// The same composition on a live Screen Output. An unset value means acceptance
		// passed the input over — because its binding resolved nothing, or because its
		// value was unavailable — and the authored default is placeholder text that must
		// never reach program looking like live data.
		const model = resolveBroadcastGraphicsRenderModel(input({
			graphics: [templateGraphic()],
			onAirGraphicIds: ['lower-third'],
			inputValues: { 'lower-third': { title: 'Champion' } },
		}));

		expect(model.graphics[0]!.items[0]!.text).toBe(' — Champion');
	});

	it('renders nothing for an unset Graphic Input when the caller says nothing at all', () => {
		// Forgetting to declare which situation this is must fail towards a missing
		// value, never a fabricated one.
		const model = resolveBroadcastGraphicsRenderModel(input({
			graphics: [templateGraphic()],
			onAirGraphicIds: ['lower-third'],
		}));

		expect(model.graphics[0]!.items[0]!.text).toBe(' — ');
	});

	it('renders nothing for a value that violates its declared constraints', () => {
		// Unavailable rather than coerced: the literal text around it still renders.
		const model = resolveBroadcastGraphicsRenderModel(input({
			graphics: [templateGraphic()],
			onAirGraphicIds: ['lower-third'],
			inputValues: { 'lower-third': { name: 'A'.repeat(50), title: 'Champion' } },
		}));

		expect(model.graphics[0]!.items[0]!.text).toBe(' — Champion');
	});

	it('gives one placeholder its own Graphic Placeholder Style and leaves the literal text alone', () => {
		const model = resolveBroadcastGraphicsRenderModel(input({
			graphics: [templateGraphic()],
			onAirGraphicIds: ['lower-third'],
			inputValues: { 'lower-third': { name: 'Ava Reed', title: 'Champion' } },
		}));
		const segments = model.graphics[0]!.items[0]!.textSegments!;

		expect(segments.map(segment => segment.inputKey)).toEqual(['name', undefined, 'title']);
		expect(segments[0]!.style).toBeUndefined();
		expect(segments[1]!.style).toBeUndefined();
		// Only what the style overrides, so the run inherits the rest of the item's
		// base typography.
		expect(segments[2]!.style).toEqual({ fontWeight: 300, fontSize: '24px' });
	});

	it('resolves a Graphic Placeholder Style colour to white in the Key Output', () => {
		// Every painted element has to be white at its own alpha or the alpha matte
		// stops accumulating correctly.
		const model = resolveBroadcastGraphicsRenderModel(input({
			output: 'key',
			graphics: [templateGraphic({ title: { color: '#ff0000' } })],
			onAirGraphicIds: ['lower-third'],
			inputValues: { 'lower-third': { name: 'Ava Reed', title: 'Champion' } },
		}));

		expect(model.graphics[0]!.items[0]!.textSegments![2]!.style).toEqual({ color: '#ffffff' });
	});
});
