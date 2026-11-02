import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAYER_DATA } from '~/types';
import { buildFeatureMatchSetupUpdate, normalizePlayerSlotData } from '~/utils/featureMatchSetup';

describe('featureMatchSetup payload helpers', () => {
	it('normalizes partial player metadata and numeric strings', () => {
		const update = buildFeatureMatchSetupUpdate({
			player1Data: { ...DEFAULT_PLAYER_DATA, name: '', position: '4' as any },
		});

		expect(update.player1Data).toEqual({ name: null, position: 4 });
	});

	it('turns completely empty player metadata into null', () => {
		expect(normalizePlayerSlotData({
			...DEFAULT_PLAYER_DATA,
			gameData: { type: 'mtg', deckName: '', deckColors: null },
		})).toBeNull();
	});

	// A save sends the picked Leader whole; free text typed before the picker names no card.
	it.each([
		{
			leader: {
				number: 'OP01-001',
				name: 'Roronoa Zoro',
				colors: ['Red'],
				imageUrl: 'https://cards-img.keepr.digital/OP01-001.png',
			},
			gameData: {
				type: 'op',
				leader: {
					number: 'OP01-001',
					name: 'Roronoa Zoro',
					colors: ['Red'],
					imageUrl: 'https://cards-img.keepr.digital/OP01-001.png',
				},
			},
		},
		{ leader: 'Zoro', gameData: null },
		{ leader: null, gameData: null },
	])('saves a side\'s Leader $leader as $gameData', ({ leader, gameData }) => {
		expect(normalizePlayerSlotData({
			...DEFAULT_PLAYER_DATA,
			name: 'Ana',
			gameData: { type: 'op', leader } as any,
		})?.gameData).toEqual(gameData);
	});

	it('turns blank numeric inputs into null', () => {
		const update = buildFeatureMatchSetupUpdate({
			tableNumber: '' as any,
			player1Data: { ...DEFAULT_PLAYER_DATA, wins: '' as any },
		});

		expect(update.tableNumber).toBeNull();
		expect(update.player1Data).toBeNull();
	});
});
