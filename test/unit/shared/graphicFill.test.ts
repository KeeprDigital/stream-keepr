import type { GraphicFill } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import { applyGraphicFillEdit } from '~~/shared/modules/graphics';

// One Graphic Fill edit for every host: the colour is opaque to it, and only a new
// gradient's end stop is the host's to choose.

const gradient: GraphicFill = {
	type: 'linear-gradient',
	angle: 90,
	stops: [
		{ color: 'brand', position: 0, opacity: 1 },
		{ color: 'ink', position: 1, opacity: 1 },
	],
};

describe('applyGraphicFillEdit', () => {
	it('switches a solid fill to a gradient that starts from its colour', () => {
		const solid: GraphicFill = { type: 'solid', color: '#123456' };

		expect(applyGraphicFillEdit(solid, { kind: 'fill-kind', fillKind: 'linear-gradient' }, { gradientEndColor: '#000000' }))
			.toEqual({
				type: 'linear-gradient',
				angle: 90,
				stops: [
					{ color: '#123456', position: 0, opacity: 1 },
					{ color: '#000000', position: 1, opacity: 1 },
				],
			});
	});

	it('ends a new gradient on the fill\'s own colour where the host names no end colour', () => {
		const solid: GraphicFill = { type: 'solid', color: 'brand' };

		const next = applyGraphicFillEdit(solid, { kind: 'fill-kind', fillKind: 'linear-gradient' });

		expect(next.type === 'linear-gradient' && next.stops.map(stop => stop.color)).toEqual(['brand', 'brand']);
	});

	it('switches a gradient back to solid on its first stop\'s colour, so changing kind is never a reset', () => {
		expect(applyGraphicFillEdit(gradient, { kind: 'fill-kind', fillKind: 'solid' }))
			.toEqual({ type: 'solid', color: 'brand' });
	});

	it('leaves a fill already of the chosen kind as it is', () => {
		expect(applyGraphicFillEdit(gradient, { kind: 'fill-kind', fillKind: 'linear-gradient' })).toBe(gradient);
	});

	it('edits one stop and the angle without disturbing the others', () => {
		const angled = applyGraphicFillEdit(gradient, { kind: 'gradient-angle', angle: 135 });
		const next = applyGraphicFillEdit(angled, {
			kind: 'gradient-stop',
			index: 1,
			patch: { opacity: 0.4 },
		});

		expect(next).toEqual({
			type: 'linear-gradient',
			angle: 135,
			stops: [
				{ color: 'brand', position: 0, opacity: 1 },
				{ color: 'ink', position: 1, opacity: 0.4 },
			],
		});
	});

	it('holds a gradient between two and four stops, a new one copying the last at the end', () => {
		let grown: GraphicFill = gradient;
		for (let index = 0; index < 5; index += 1)
			grown = applyGraphicFillEdit(grown, { kind: 'stop-count', delta: 1 });

		let shrunk: GraphicFill = grown;
		for (let index = 0; index < 5; index += 1)
			shrunk = applyGraphicFillEdit(shrunk, { kind: 'stop-count', delta: -1 });

		expect(grown.type === 'linear-gradient' && grown.stops).toEqual([
			{ color: 'brand', position: 0, opacity: 1 },
			{ color: 'ink', position: 1, opacity: 1 },
			{ color: 'ink', position: 1, opacity: 1 },
			{ color: 'ink', position: 1, opacity: 1 },
		]);
		expect(shrunk).toEqual(gradient);
	});

	it('ignores a gradient edit aimed at a solid fill, and a solid colour aimed at a gradient', () => {
		const solid: GraphicFill = { type: 'solid', color: 'brand' };

		expect(applyGraphicFillEdit(solid, { kind: 'stop-count', delta: 1 })).toBe(solid);
		expect(applyGraphicFillEdit(solid, { kind: 'gradient-angle', angle: 45 })).toBe(solid);
		expect(applyGraphicFillEdit(gradient, { kind: 'solid-fill', color: 'ink' })).toBe(gradient);
		expect(applyGraphicFillEdit(solid, { kind: 'solid-fill', color: 'ink' })).toEqual({ type: 'solid', color: 'ink' });
	});
});
