import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockMatch } from '~~/test/helpers/fixtures';
import { DEFAULT_PLAYER_DATA } from '~/types';

const mockFeatureMatchStateStore = {
	swapPlayers: vi.fn(),
	resetMatch: vi.fn(),
};
const mockToast = { add: vi.fn() };

mockNuxtImport('useEventStore', () => () => ({ eventId: 1 }));
mockNuxtImport('useFeatureMatchStateStore', () => () => mockFeatureMatchStateStore);
mockNuxtImport('useToast', () => () => mockToast);

describe('useFeatureMatchSetupActions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	function createFormData() {
		return ref({
			id: 1,
			player1Id: 10,
			player2Id: 20,
			player1Data: { ...DEFAULT_PLAYER_DATA, name: 'Alice' },
			player2Data: { ...DEFAULT_PLAYER_DATA, name: 'Bob' },
			externalId: null,
			externalSource: null,
			tableNumber: null,
		});
	}

	function createSetup(formData = createFormData()) {
		const getDeckForCurrentPhase = vi.fn((_, name, colors) => ({ name, colors }));
		return {
			...useFeatureMatchSetupActions({
				formData: formData as any,
				getDeckForCurrentPhase,
			}),
			formData,
			getDeckForCurrentPhase,
		};
	}

	it('swaps player data and IDs', async () => {
		mockFeatureMatchStateStore.swapPlayers.mockResolvedValue(undefined);
		const { swapPlayers, formData } = createSetup();

		await swapPlayers();

		expect(formData.value.player1Data.name).toBe('Bob');
		expect(formData.value.player2Data.name).toBe('Alice');
		expect(formData.value.player1Id).toBe(20);
		expect(formData.value.player2Id).toBe(10);
	});

	it('shows success toast after swapping', async () => {
		mockFeatureMatchStateStore.swapPlayers.mockResolvedValue(undefined);
		const { swapPlayers } = createSetup();

		await swapPlayers();
		expect(mockToast.add).toHaveBeenCalledWith(expect.objectContaining({
			title: 'Players swapped',
			color: 'success',
		}));
	});

	it('shows success toast after clearing', async () => {
		mockFeatureMatchStateStore.resetMatch.mockResolvedValue(undefined);
		const { clearMatch } = createSetup();

		await clearMatch();

		expect(mockToast.add).toHaveBeenCalledWith(expect.objectContaining({
			title: 'Match cleared',
			color: 'success',
		}));
	});

	it('clears match data', async () => {
		mockFeatureMatchStateStore.resetMatch.mockResolvedValue(undefined);
		const { clearMatch, formData } = createSetup();

		await clearMatch();

		expect(formData.value.player1Data.name).toBe('');
		expect(formData.value.player2Data.name).toBe('');
		expect(formData.value.player1Id).toBeNull();
		expect(formData.value.player2Id).toBeNull();
	});

	it('resets match state when clearing', async () => {
		mockFeatureMatchStateStore.resetMatch.mockResolvedValue(undefined);
		const { clearMatch } = createSetup();

		await clearMatch();
		expect(mockFeatureMatchStateStore.resetMatch).toHaveBeenCalledWith(1, 1, { type: 'match' });
	});

	// ── populateFromMelee ──

	describe('populateFromMelee', () => {
		function createMeleeMatch(playerOverrides: { p1Name?: string; p2Name?: string; tableNumber?: number } = {}) {
			return createMockMatch({
				id: 5,
				player1Id: 10,
				player2Id: 20,
				externalId: 'ext-001',
				externalSource: 'melee',
				tableNumber: playerOverrides.tableNumber ?? 3,
				player1Data: { name: playerOverrides.p1Name ?? 'Alice', wins: 5, losses: 2, draws: 0 } as any,
				player2Data: { name: playerOverrides.p2Name ?? 'Bob', wins: 4, losses: 3, draws: 0 } as any,
			});
		}

		it('maps player names, IDs and match metadata into formData', async () => {
			mockFeatureMatchStateStore.resetMatch.mockResolvedValue(undefined);
			const { populateFromMelee, formData } = createSetup();

			await populateFromMelee(createMeleeMatch() as any);

			expect(formData.value.player1Id).toBe(10);
			expect(formData.value.player2Id).toBe(20);
			expect(formData.value.player1Data.name).toBe('Alice');
			expect(formData.value.player2Data.name).toBe('Bob');
			expect(formData.value.externalId).toBe('ext-001');
			expect(formData.value.externalSource).toBe('melee');
			expect(formData.value.tableNumber).toBe(3);
		});

		it('uses deck info from getDeckForCurrentPhase', async () => {
			mockFeatureMatchStateStore.resetMatch.mockResolvedValue(undefined);
			const { populateFromMelee, formData, getDeckForCurrentPhase } = createSetup();
			getDeckForCurrentPhase.mockReturnValueOnce({ name: 'Azorius Control', colors: 'WU' });
			getDeckForCurrentPhase.mockReturnValueOnce({ name: 'Rakdos Midrange', colors: 'BR' });

			await populateFromMelee(createMeleeMatch() as any);

			expect(formData.value.player1Data.gameData).toMatchObject({ type: 'mtg', deckName: 'Azorius Control', deckColors: 'WU' });
			expect(formData.value.player2Data.gameData).toMatchObject({ type: 'mtg', deckName: 'Rakdos Midrange', deckColors: 'BR' });
		});

		it('passes MTG deck data from match playerData to getDeckForCurrentPhase', async () => {
			mockFeatureMatchStateStore.resetMatch.mockResolvedValue(undefined);
			const match = createMockMatch({
				player1Id: 10,
				player2Id: 20,
				player1Data: { name: 'Alice', gameData: { type: 'mtg', deckName: 'Bogles', deckColors: 'GW' } } as any,
				player2Data: { name: 'Bob', gameData: { type: 'mtg', deckName: 'Burn', deckColors: 'R' } } as any,
			});
			const { populateFromMelee, getDeckForCurrentPhase } = createSetup();

			await populateFromMelee(match as any);

			expect(getDeckForCurrentPhase).toHaveBeenNthCalledWith(1, 10, 'Bogles', 'GW');
			expect(getDeckForCurrentPhase).toHaveBeenNthCalledWith(2, 20, 'Burn', 'R');
		});

		it('closes meleeModalOpen', async () => {
			mockFeatureMatchStateStore.resetMatch.mockResolvedValue(undefined);
			const { populateFromMelee, meleeModalOpen } = createSetup();
			meleeModalOpen.value = true;

			await populateFromMelee(createMeleeMatch() as any);

			expect(meleeModalOpen.value).toBe(false);
		});

		it('calls resetMatch with type: match', async () => {
			mockFeatureMatchStateStore.resetMatch.mockResolvedValue(undefined);
			const { populateFromMelee } = createSetup();

			await populateFromMelee(createMeleeMatch() as any);

			expect(mockFeatureMatchStateStore.resetMatch).toHaveBeenCalledWith(1, 1, { type: 'match' });
		});

		it('shows success toast with table number', async () => {
			mockFeatureMatchStateStore.resetMatch.mockResolvedValue(undefined);
			const { populateFromMelee } = createSetup();

			await populateFromMelee(createMeleeMatch({ tableNumber: 7 }) as any);

			expect(mockToast.add).toHaveBeenCalledWith(expect.objectContaining({
				title: 'Match populated',
				description: 'Populated from Table 7',
				color: 'success',
			}));
		});

		it('uses TBD when player name is missing', async () => {
			mockFeatureMatchStateStore.resetMatch.mockResolvedValue(undefined);
			const match = createMockMatch({
				player1Data: null,
				player2Data: null,
			});
			const { populateFromMelee, formData } = createSetup();

			await populateFromMelee(match as any);

			expect(formData.value.player1Data.name).toBe('TBD');
			expect(formData.value.player2Data.name).toBe('TBD');
		});
	});
});
