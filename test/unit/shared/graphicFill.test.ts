import type { GraphicFill } from '~~/shared/types/graphics';
import type { FillGraphicStyleEntryValue } from '~~/shared/types/graphicStyleSet';
import { describe, expect, it } from 'vitest';
import { applyGraphicStyleFillEntryEdit, graphicFillOfStyleEntry } from '~~/shared/modules/graphic-style-sets';
import { applyGraphicFillEdit } from '~~/shared/modules/graphics';

/**
 * One Graphic Fill edit, applied the same way wherever a fill is authored.
 *
 * The colour is opaque to the edit: a Graphic Item's fill holds a CSS colour and
 * a Graphic Style Set fill entry holds a palette entry id, and both take the same
 * edits through the same rules. Only what a new gradient's end stop starts as is
 * the host's to say.
 */

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
		const next = applyGraphicFillEdit(angled, { kind: 'gradient-stop', index: 1, patch: { opacity: 0.4 } });

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

	it('applies the same edits to a Graphic Style Set fill entry, on its palette entry ids', () => {
		const entry: FillGraphicStyleEntryValue = { type: 'solid', colorEntryId: 'brand' };

		const gradientEntry = applyGraphicStyleFillEntryEdit(entry, { kind: 'fill-kind', fillKind: 'linear-gradient' });
		const grown = applyGraphicStyleFillEntryEdit(
			applyGraphicStyleFillEntryEdit(gradientEntry, { kind: 'gradient-stop', index: 1, patch: { color: 'ink' } }),
			{ kind: 'stop-count', delta: 1 },
		);

		expect(grown).toEqual({
			type: 'linear-gradient',
			angle: 90,
			stops: [
				{ colorEntryId: 'brand', position: 0, opacity: 1 },
				{ colorEntryId: 'ink', position: 1, opacity: 1 },
				{ colorEntryId: 'ink', position: 1, opacity: 1 },
			],
		});
		expect(graphicFillOfStyleEntry(grown)).toEqual({
			type: 'linear-gradient',
			angle: 90,
			stops: [
				{ color: 'brand', position: 0, opacity: 1 },
				{ color: 'ink', position: 1, opacity: 1 },
				{ color: 'ink', position: 1, opacity: 1 },
			],
		});
		expect(applyGraphicStyleFillEntryEdit(grown, { kind: 'fill-kind', fillKind: 'solid' }))
			.toEqual({ type: 'solid', colorEntryId: 'brand' });
	});

	it('ignores a gradient edit aimed at a solid fill, and a solid colour aimed at a gradient', () => {
		const solid: GraphicFill = { type: 'solid', color: 'brand' };

		expect(applyGraphicFillEdit(solid, { kind: 'stop-count', delta: 1 })).toBe(solid);
		expect(applyGraphicFillEdit(solid, { kind: 'gradient-angle', angle: 45 })).toBe(solid);
		expect(applyGraphicFillEdit(gradient, { kind: 'solid-fill', color: 'ink' })).toBe(gradient);
		expect(applyGraphicFillEdit(solid, { kind: 'solid-fill', color: 'ink' })).toEqual({ type: 'solid', color: 'ink' });
	});
});
