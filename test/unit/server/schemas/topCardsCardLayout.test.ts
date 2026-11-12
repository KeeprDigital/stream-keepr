import { describe, expect, it } from 'vitest';
import { modeConfigPatchSchemaMap } from '~~/server/schemas/api/screen';
import { getDisplayDefaultsForMode, resolveScreenModeConfig, toModeConfigPatch } from '~~/shared/types/screenConfig';

describe('a Most Played Cards Screen\'s Card Layout', () => {
	it('is all Auto until set, and a reset returns each value to Auto', () => {
		expect(resolveScreenModeConfig({}, 'top-cards')).toMatchObject({
			columns: undefined,
			maxCardSize: undefined,
			cardGap: undefined,
		});
		expect(toModeConfigPatch('top-cards', getDisplayDefaultsForMode('top-cards'))).toMatchObject({
			columns: null,
			maxCardSize: null,
			cardGap: null,
		});
	});

	// Columns run to the most cards a Screen ranks, a max card size to the largest Event Canvas side.
	it.each([
		{ field: 'columns', value: 0, accepted: false },
		{ field: 'columns', value: 1, accepted: true },
		{ field: 'columns', value: 60, accepted: true },
		{ field: 'columns', value: 61, accepted: false },
		{ field: 'maxCardSize', value: 47, accepted: false },
		{ field: 'maxCardSize', value: 48, accepted: true },
		{ field: 'maxCardSize', value: 7680, accepted: true },
		{ field: 'maxCardSize', value: 7681, accepted: false },
		{ field: 'cardGap', value: -1, accepted: false },
		{ field: 'cardGap', value: 0, accepted: true },
		{ field: 'cardGap', value: 100, accepted: true },
		{ field: 'cardGap', value: 101, accepted: false },
		{ field: 'columns', value: null, accepted: true },
		{ field: 'maxCardSize', value: null, accepted: true },
		{ field: 'cardGap', value: null, accepted: true },
	])('a write of $field $value is accepted: $accepted', ({ field, value, accepted }) => {
		expect(modeConfigPatchSchemaMap['top-cards'].safeParse({ [field]: value }).success).toBe(accepted);
	});
});
