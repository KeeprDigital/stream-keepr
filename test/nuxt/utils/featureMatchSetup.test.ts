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

	it('turns blank numeric inputs into null', () => {
		const update = buildFeatureMatchSetupUpdate({
			tableNumber: '' as any,
			player1Data: { ...DEFAULT_PLAYER_DATA, wins: '' as any },
		});

		expect(update.tableNumber).toBeNull();
		expect(update.player1Data).toBeNull();
	});
});
