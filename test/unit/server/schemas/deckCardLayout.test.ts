import { describe, expect, it } from 'vitest';
import { modeConfigPatchSchemaMap } from '~~/server/schemas/api/screen';
import { resolveDeckBoards, resolveScreenModeConfig } from '~~/shared/types/screenConfig';

describe('a Deck List board\'s Card Layout', () => {
	it('is all Auto until set', () => {
		const { mainboard, sideboard } = resolveDeckBoards(resolveScreenModeConfig({}, 'deck'));

		for (const board of [mainboard, sideboard]) {
			expect(board.columns).toBeUndefined();
			expect(board.maxCardSize).toBeUndefined();
			expect(board.cardGap).toBeUndefined();
		}
	});

	// Columns run to the most cards a board lays out, a max card size to the largest Event Canvas side.
	it.each([
		{ field: 'columns', value: 0, accepted: false },
		{ field: 'columns', value: 1, accepted: true },
		{ field: 'columns', value: 100, accepted: true },
		{ field: 'columns', value: 101, accepted: false },
		{ field: 'maxCardSize', value: 47, accepted: false },
		{ field: 'maxCardSize', value: 48, accepted: true },
		{ field: 'maxCardSize', value: 7680, accepted: true },
		{ field: 'maxCardSize', value: 7681, accepted: false },
		{ field: 'cardGap', value: -1, accepted: false },
		{ field: 'cardGap', value: 0, accepted: true },
		{ field: 'cardGap', value: 100, accepted: true },
		{ field: 'cardGap', value: 101, accepted: false },
	])('a write of a board\'s $field $value is accepted: $accepted', ({ field, value, accepted }) => {
		for (const board of ['mainboard', 'sideboard'] as const) {
			expect(modeConfigPatchSchemaMap.deck.safeParse({
				[board]: { [field]: value },
			}).success).toBe(accepted);
		}
	});
});
