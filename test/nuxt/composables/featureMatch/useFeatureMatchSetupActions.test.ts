import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockMatch } from '~~/test/helpers/fixtures';
import { DEFAULT_PLAYER_DATA } from '~/types';

const mockFeatureMatchStateStore = {
	swapPlayers: vi.fn(),
	resetMatch: vi.fn(),
};
const mockToast = {
	add: vi.fn(),
};

mockNuxtImport('useEventStore', () => () => ({ eventId: 1 }));
mockNuxtImport('useFeatureMatchStateStore', () => () => mockFeatureMatchStateStore);
mockNuxtImport('useToast', () => () => mockToast);

function createSetup() {
	const formData = ref({
		id: 1,
		player1Id: 10 as number | null,
		player2Id: 20 as number | null,
		player1Data: { ...DEFAULT_PLAYER_DATA, name: 'Alice' },
		player2Data: { ...DEFAULT_PLAYER_DATA, name: 'Bob' },
		externalId: 'ext-000' as string | null,
		externalSource: 'melee' as string | null,
		tableNumber: null as number | null,
	});
	const getDeckForCurrentPhase = vi.fn((_: number | null, name: string | null, colors: string | null) => ({ name, colors }));
	return {
		...useFeatureMatchSetupActions({ formData: formData as any, getDeckForCurrentPhase }),
		formData,
		getDeckForCurrentPhase,
	};
}

function seats(formData: ReturnType<typeof createSetup>['formData']) {
	return [
		formData.value.player1Id,
		formData.value.player1Data.name,
		formData.value.player2Id,
		formData.value.player2Data.name,
	];
}

describe('useFeatureMatchSetupActions', () => {
	beforeEach(() => {
		mockFeatureMatchStateStore.swapPlayers.mockResolvedValue(undefined);
		mockFeatureMatchStateStore.resetMatch.mockResolvedValue(undefined);
	});

	describe('swapping players', () => {
		it('swaps the seats and the Session, and says so', async () => {
			const { swapPlayers, formData } = createSetup();

			await swapPlayers();

			expect(seats(formData)).toEqual([20, 'Bob', 10, 'Alice']);
			expect(mockFeatureMatchStateStore.swapPlayers).toHaveBeenCalledWith(1, 1);
			expect(mockToast.add).toHaveBeenCalledWith(expect.objectContaining({ title: 'Players swapped', color: 'success' }));
		});

		it('puts the seats back when the Session refuses the swap', async () => {
			mockFeatureMatchStateStore.swapPlayers.mockRejectedValue(new Error('refused'));
			const { swapPlayers, formData } = createSetup();

			await swapPlayers();

			expect(seats(formData)).toEqual([10, 'Alice', 20, 'Bob']);
			expect(mockToast.add).toHaveBeenCalledWith(expect.objectContaining({ title: 'Failed to swap players', color: 'error' }));
		});
	});

	describe('clearing the match', () => {
		it('empties both seats and resets the Session', async () => {
			const { clearMatch, formData } = createSetup();

			await clearMatch();

			expect(seats(formData)).toEqual([null, '', null, '']);
			expect(formData.value.externalId).toBeNull();
			expect(mockFeatureMatchStateStore.resetMatch).toHaveBeenCalledWith(1, 1, { type: 'match' });
			expect(mockToast.add).toHaveBeenCalledWith(expect.objectContaining({ title: 'Match cleared', color: 'success' }));
		});

		it('restores the seats when the reset is refused', async () => {
			mockFeatureMatchStateStore.resetMatch.mockRejectedValue(new Error('refused'));
			const { clearMatch, formData } = createSetup();

			await clearMatch();

			expect(seats(formData)).toEqual([10, 'Alice', 20, 'Bob']);
			expect(formData.value.externalId).toBe('ext-000');
		});
	});

	describe('populating from Melee', () => {
		function meleeMatch() {
			return createMockMatch({
				id: 5,
				player1Id: 10,
				player2Id: 20,
				externalId: 'ext-001',
				externalSource: 'melee',
				tableNumber: 7,
				player1Data: {
					name: 'Alice',
					gameData: { type: 'mtg', deckName: 'Bogles', deckColors: 'GW' },
				} as any,
				player2Data: {
					name: 'Bob',
					gameData: { type: 'mtg', deckName: 'Burn', deckColors: 'R' },
				} as any,
			});
		}

		it('seats the Match\'s Players with this Phase\'s decks, resets the Session and closes the picker', async () => {
			const { populateFromMelee, formData, getDeckForCurrentPhase, meleeModalOpen } = createSetup();
			getDeckForCurrentPhase
				.mockReturnValueOnce({ name: 'Azorius Control', colors: 'WU' })
				.mockReturnValueOnce({ name: 'Rakdos Midrange', colors: 'BR' });
			meleeModalOpen.value = true;

			await populateFromMelee(meleeMatch() as any);

			expect(getDeckForCurrentPhase).toHaveBeenNthCalledWith(1, 10, 'Bogles', 'GW');
			expect(getDeckForCurrentPhase).toHaveBeenNthCalledWith(2, 20, 'Burn', 'R');
			expect(seats(formData)).toEqual([10, 'Alice', 20, 'Bob']);
			expect(formData.value).toMatchObject({ externalId: 'ext-001', externalSource: 'melee', tableNumber: 7 });
			expect(formData.value.player1Data.gameData).toMatchObject({ type: 'mtg', deckName: 'Azorius Control', deckColors: 'WU' });
			expect(formData.value.player2Data.gameData).toMatchObject({ type: 'mtg', deckName: 'Rakdos Midrange', deckColors: 'BR' });
			expect(mockFeatureMatchStateStore.resetMatch).toHaveBeenCalledWith(1, 1, { type: 'match' });
			expect(meleeModalOpen.value).toBe(false);
			expect(mockToast.add).toHaveBeenCalledWith(expect.objectContaining({ description: 'Populated from Table 7', color: 'success' }));
		});

		it('seats TBD for a Player the Match does not name', async () => {
			const { populateFromMelee, formData } = createSetup();

			await populateFromMelee(createMockMatch({ player1Data: null, player2Data: null }) as any);

			expect(formData.value.player1Data.name).toBe('TBD');
			expect(formData.value.player2Data.name).toBe('TBD');
		});
	});
});
