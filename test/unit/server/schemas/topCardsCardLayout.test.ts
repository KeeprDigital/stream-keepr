import { describe, expect, it } from 'vitest';
import { mapScreenToResponse } from '~~/server/mappers/screen';
import { modeConfigPatchSchemaMap, modeConfigsMapSchema, parseModeConfigPatchResult } from '~~/server/schemas/api/screen';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { getDisplayDefaultsForMode, resolveScreenModeConfig, toModeConfigPatch } from '~~/shared/types/screenConfig';
import { createMockScreen } from '~~/test/helpers/fixtures';

const contract = screenModeConfigContract('top-cards');

/**
 * A Most Played Cards Screen's Card Layout as an earlier contract stored it,
 * under Card Sizing, reads as the Auto-or-number fields that replaced it.
 */
describe('a Most Played Cards Screen storing a Card Sizing', () => {
	it.each([
		{
			name: 'a Fixed width is the max card size',
			stored: { cardSizing: 'fixed', cardWidth: 200, columns: 4 },
			reads: { maxCardSize: 200, columns: 4 },
		},
		{
			name: 'a Fixed width never written is the former default width',
			stored: { cardSizing: 'fixed' },
			reads: { maxCardSize: 160 },
		},
		{
			name: 'a Fit grid has no max card size, whatever width it stored',
			stored: { cardSizing: 'fit', cardWidth: 200 },
			reads: {},
		},
		{
			name: 'no Card Sizing is the former default, Fit',
			stored: { cardWidth: 200, limit: 12 },
			reads: { limit: 12 },
		},
		{
			name: 'a column count with auto columns on is Auto',
			stored: { autoColumns: true, columns: 5 },
			reads: {},
		},
		{
			name: 'a column count with auto columns off is kept',
			stored: { autoColumns: false, columns: 5, cardGap: 20 },
			reads: { columns: 5, cardGap: 20 },
		},
		{
			name: 'Fixed auto columns keep the max card size and choose the columns',
			stored: {
				cardSizing: 'fixed',
				cardWidth: 96,
				autoColumns: true,
				columns: 7,
			},
			reads: { maxCardSize: 96 },
		},
	])('$name', ({ stored, reads }) => {
		expect(contract.readStored(stored)).toEqual(reads);
		expect(mapScreenToResponse(createMockScreen({
			modeConfigs: { 'top-cards': stored },
		})).modeConfigs).toEqual({ 'top-cards': reads });
		expect(JSON.parse(JSON.stringify(modeConfigsMapSchema.parse({ 'top-cards': stored })))).toEqual({ 'top-cards': reads });
		// What it reads as reads as itself: an upgrade runs on every read.
		expect(contract.readStored(reads)).toBe(reads);
	});

	it.each([
		{
			name: 'of another field keeps the max card size',
			patch: { limit: 12 },
			patched: { showHeader: false, maxCardSize: 200, limit: 12 },
		},
		{
			name: 'clearing the max card size is not undone by the stored width',
			patch: { maxCardSize: null },
			patched: { showHeader: false },
		},
		{
			name: 'of the max card size replaces the stored width',
			patch: { maxCardSize: 300 },
			patched: { showHeader: false, maxCardSize: 300 },
		},
	])('a PATCH $name', ({ patch, patched }) => {
		const stored = {
			'top-cards': { cardSizing: 'fixed', cardWidth: 200, showHeader: false },
		};
		const parsed = modeConfigPatchSchemaMap['top-cards'].parse(patch) as Record<string, unknown>;

		expect(parseModeConfigPatchResult(stored, 'top-cards', parsed)).toEqual({ 'top-cards': patched });
	});
});

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
