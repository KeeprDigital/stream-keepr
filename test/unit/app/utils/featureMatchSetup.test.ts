import { describe, expect, it } from 'vitest';
import { ATRAXA, TYMNA } from '~~/test/helpers/commanders';
import { ZORO } from '~~/test/helpers/opCards';
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

	it.each([
		{
			leader: ZORO,
			gameData: { type: 'op', leader: ZORO },
		},
		{ leader: null, gameData: null },
	])('saves a side\'s Leader $leader whole', ({ leader, gameData }) => {
		expect(normalizePlayerSlotData({
			...DEFAULT_PLAYER_DATA,
			name: 'Ana',
			gameData: { type: 'op', leader },
		})?.gameData).toEqual(gameData);
	});

	// The reference is how a side keeps its Deck List through a setup save.
	it.each([
		{
			leader: ZORO,
			featureMatchDeckList: { id: 4, mainboardCount: 50 },
		},
		{
			leader: null,
			featureMatchDeckList: { id: 4, mainboardCount: 50 },
		},
	])('saves a side\'s Deck List reference with Leader $leader', (gameData) => {
		expect(normalizePlayerSlotData({
			...DEFAULT_PLAYER_DATA,
			gameData: { type: 'op', ...gameData },
		})?.gameData).toEqual({ type: 'op', ...gameData });
	});

	it('turns blank numeric inputs into null', () => {
		const update = buildFeatureMatchSetupUpdate({
			tableNumber: '' as any,
			player1Data: { ...DEFAULT_PLAYER_DATA, wins: '' as any },
		});

		expect(update.tableNumber).toBeNull();
		expect(update.player1Data).toBeNull();
	});

	// A Seat's deck name and colours are the server's, written from its Commanders (ADR-0087).
	it.each([
		{
			held: 'its Commanders alone',
			commanders: [ATRAXA, TYMNA],
			gameData: {
				type: 'mtg',
				commanders: [ATRAXA, TYMNA],
			},
		},
		{ held: 'no game data once its last Commander is removed', commanders: [], gameData: null },
		{
			held: 'its Commanders and its Deck List reference',
			commanders: [ATRAXA],
			featureMatchDeckList: { id: 4, mainboardCount: 99 },
			gameData: {
				type: 'mtg',
				commanders: [ATRAXA],
				featureMatchDeckList: { id: 4, mainboardCount: 99 },
			},
		},
		{
			held: 'its Commanders and no Deck List once the list is cleared',
			commanders: [ATRAXA],
			featureMatchDeckList: null,
			gameData: {
				type: 'mtg',
				commanders: [ATRAXA],
				featureMatchDeckList: null,
			},
		},
		{
			held: 'its Deck List while no Commander is picked from it',
			commanders: [],
			featureMatchDeckList: { id: 4, mainboardCount: 100 },
			gameData: {
				type: 'mtg',
				commanders: [],
				featureMatchDeckList: { id: 4, mainboardCount: 100 },
			},
		},
	])('saves a Seat holding Commanders as $held', ({ commanders, gameData, ...reference }) => {
		expect(normalizePlayerSlotData({
			...DEFAULT_PLAYER_DATA,
			name: 'Cyd',
			gameData: {
				type: 'mtg',
				commanders,
				deckName: 'Atraxa / Tymna',
				deckColors: 'WUBG',
				...reference,
			},
		})?.gameData).toEqual(gameData);
	});

	it('sends an edit to Seat 3 or 4 as it sends one to Seat 1', () => {
		expect(buildFeatureMatchSetupUpdate({
			player3Data: { ...DEFAULT_PLAYER_DATA, name: ' Cyd ' },
			player4Data: { ...DEFAULT_PLAYER_DATA },
		})).toEqual({
			player3Data: { name: 'Cyd' },
			player4Data: null,
		});
	});
});
