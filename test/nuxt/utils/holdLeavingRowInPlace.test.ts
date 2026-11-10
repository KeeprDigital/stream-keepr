import { describe, expect, it } from 'vitest';
import { createLeavingRowHold } from '~/utils/tableRowLayout';

/** A table whose rows report the layout a browser would give them. */
function tableOf(places: Array<{ top: number; height: number }>) {
	const table = document.createElement('div');
	const layout = new Map<HTMLElement, { top: number; height: number }>();
	for (const place of places) {
		const row = document.createElement('div');
		layout.set(row, place);
		Object.defineProperty(row, 'offsetTop', {
			get: () => layout.get(row)!.top,
		});
		Object.defineProperty(row, 'offsetHeight', {
			get: () => layout.get(row)!.height,
		});
		table.appendChild(row);
	}
	return {
		table,
		rows: [
			...layout.keys(),
		],
		relayout: (row: HTMLElement, place: { top: number; height: number }) => layout.set(row, place),
	};
}

describe('createLeavingRowHold', () => {
	// A leaving row is out of flow, where its place is the top of the table: every
	// outgoing row would slide there, over the page coming in. It keeps the place
	// it had before the update, since by the time it leaves the table has moved on.
	it.each([
		{ row: 'the first row', index: 0, top: '0px' },
		{ row: 'a row further down', index: 3, top: '381px' },
	])('holds $row where it stood before the table updated', ({ index, top }) => {
		const { table, rows, relayout } = tableOf([0, 127, 254, 381].map(at => ({ top: at, height: 127 })));
		const { remember, hold } = createLeavingRowHold();
		remember(table);
		relayout(rows[index]!, { top: 0, height: 0 });

		hold(rows[index]!);

		expect({ top: rows[index]!.style.top, height: rows[index]!.style.height }).toEqual({ top, height: '127px' });
	});

	it('leaves a row it never saw alone', () => {
		const { rows } = tableOf([
			{ top: 127, height: 127 },
		]);

		createLeavingRowHold().hold(rows[0]!);

		expect(rows[0]!.style.top).toBe('');
	});
});
