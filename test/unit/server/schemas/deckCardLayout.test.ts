import { describe, expect, it } from 'vitest';
import { mapScreenToResponse } from '~~/server/mappers/screen';
import { modeConfigPatchSchemaMap, modeConfigsMapSchema, parseModeConfigPatchResult } from '~~/server/schemas/api/screen';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { resolveDeckBoards, resolveScreenModeConfig } from '~~/shared/types/screenConfig';
import { createMockScreen } from '~~/test/helpers/fixtures';

const contract = screenModeConfigContract('deck');

/**
 * A Deck List board's layout as an earlier contract stored it reads as the Card
 * Layout that replaced it. Deck's former default was Fixed 144 px, so a board
 * an earlier contract wrote naming no Card Sizing was Fixed.
 */
describe('a Deck List board storing a Card Sizing', () => {
	it.each([
		{
			name: 'a Fixed width is the max card size',
			stored: { cardSizing: 'fixed', cardWidth: 200, columns: 4 },
			reads: { maxCardSize: 200, columns: 4 },
		},
		{
			name: 'a Fixed width never written is the former default width',
			stored: { cardSizing: 'fixed', view: 'grid' },
			reads: { maxCardSize: 144, view: 'grid' },
		},
		{
			name: 'a width with no Card Sizing was Fixed, the former default',
			stored: { cardWidth: 96, cardGap: 8 },
			reads: { maxCardSize: 96, cardGap: 8 },
		},
		{
			name: 'a Fit board has no max card size, whatever width it stored',
			stored: { cardSizing: 'fit', cardWidth: 200, alignment: 'top' },
			reads: { alignment: 'top' },
		},
		{
			name: 'an earlier board naming no Card Sizing or width was Fixed at the former default width',
			stored: { cardSize: 'large', stackOverlap: 0.2, columns: 4 },
			reads: { maxCardSize: 144, columns: 4 },
		},
		{
			name: 'an earlier board naming no Card Sizing keeps a max card size it names',
			stored: { dynamicCardSize: false, maxCardSize: 300 },
			reads: { maxCardSize: 300 },
		},
		{
			name: 'a board naming no former field is a Card Layout, its max card size Auto',
			stored: { columns: 6 },
			reads: { columns: 6 },
		},
	])('$name', ({ stored, reads }) => {
		for (const board of ['mainboard', 'sideboard'] as const) {
			const fragment = { [board]: stored };
			const read = { [board]: reads };

			expect(contract.readStored(fragment)).toEqual(read);
			expect(mapScreenToResponse(createMockScreen({
				modeConfigs: { deck: fragment },
			})).modeConfigs).toEqual({ deck: read });
			expect(JSON.parse(JSON.stringify(modeConfigsMapSchema.parse({ deck: fragment })))).toEqual({ deck: read });
			// What it reads as reads as itself: an upgrade runs on every read.
			expect(contract.readStored(read)).toBe(read);
		}
	});

	it('upgrades each board on its own, and stores no board that was not stored', () => {
		expect(contract.readStored({
			mainboard: { cardSizing: 'fixed', cardWidth: 120 },
			sideboard: {
				cardSizing: 'fit',
				cardWidth: 120,
				view: 'stack',
				stackReveal: 40,
			},
		})).toEqual({
			mainboard: { maxCardSize: 120 },
			sideboard: { view: 'stack', stackReveal: 40 },
		});
		expect(contract.readStored({
			mainboard: { cardWidth: 120 },
		})).toEqual({
			mainboard: { maxCardSize: 120 },
		});
	});

	it.each([
		{
			name: 'of another field keeps the max card size',
			patch: { showQuantities: false },
			patched: {
				mainboard: { maxCardSize: 200 },
				showQuantities: false,
			},
		},
		{
			name: 'of the board without a max card size is not undone by the stored width',
			patch: {
				mainboard: { columns: 3 },
			},
			patched: {
				mainboard: { columns: 3 },
			},
		},
	])('a PATCH $name', ({ patch, patched }) => {
		// As an earlier contract stored it, which the current config type does not admit.
		const stored: Record<string, unknown> = {
			mainboard: { cardSizing: 'fixed', cardWidth: 200 },
		};
		const parsed = modeConfigPatchSchemaMap.deck.parse(patch) as Record<string, unknown>;

		expect(parseModeConfigPatchResult({ deck: stored }, 'deck', parsed)).toEqual({ deck: patched });
	});
});

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
		// Auto columns is an absent `columns`, so a stale client's flag is refused rather than dropped.
		{ field: 'autoColumns', value: true, accepted: false },
	])('a write of a board\'s $field $value is accepted: $accepted', ({ field, value, accepted }) => {
		for (const board of ['mainboard', 'sideboard'] as const) {
			expect(modeConfigPatchSchemaMap.deck.safeParse({
				[board]: { [field]: value },
			}).success).toBe(accepted);
		}
	});
});
