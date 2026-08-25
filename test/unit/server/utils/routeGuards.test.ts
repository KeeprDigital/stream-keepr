import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
	requireArchetypeInEvent,
	requirePhaseInEvent,
	requirePlayerListInEvent,
	requireTalentInEvent,
	validateFeatureMatchReferences,
	validateScreenModeConfigReferences,
} from '~~/server/utils/routeGuards';

// Mock services
const mockArchetypeFindById = vi.fn();
const mockBroadcastDeckListSourceIsSelectable = vi.fn();
const mockFeatureMatchExists = vi.fn();
const mockFeatureMatchFindById = vi.fn();
const mockMatchExists = vi.fn();
const mockMatchFindById = vi.fn();
const mockPhaseExists = vi.fn();
const mockPlayerCountByIds = vi.fn();
const mockPlayerListFindById = vi.fn();
const mockRoundExists = vi.fn();
const mockTalentFindById = vi.fn();

vi.mock('~~/server/services/archetype', () => ({
	archetypeService: () => ({ findById: mockArchetypeFindById }),
}));
vi.mock('~~/server/services/broadcastDeckList', () => ({
	broadcastDeckListService: () => ({ sourceIsSelectable: mockBroadcastDeckListSourceIsSelectable }),
}));
vi.mock('~~/server/services/featureMatch', () => ({
	featureMatchService: () => ({ exists: mockFeatureMatchExists, findById: mockFeatureMatchFindById }),
}));
vi.mock('~~/server/services/match', () => ({
	matchService: () => ({ exists: mockMatchExists, findById: mockMatchFindById }),
}));

vi.mock('~~/server/services/phase', () => ({
	phaseService: () => ({ exists: mockPhaseExists }),
}));
vi.mock('~~/server/services/player', () => ({
	playerService: () => ({ countByIds: mockPlayerCountByIds }),
}));
vi.mock('~~/server/services/playerList', () => ({
	playerListService: () => ({ findById: mockPlayerListFindById }),
}));
vi.mock('~~/server/services/round', () => ({
	roundService: () => ({ exists: mockRoundExists }),
}));
vi.mock('~~/server/services/talent', () => ({
	talentService: () => ({ findById: mockTalentFindById }),
}));

// Mock Nitro auto-import
vi.stubGlobal('createError', (opts: any) => {
	const err = new Error(opts.message)
	;(err as any).statusCode = opts.statusCode;
	return err;
});

describe('event-scoped reference validation', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockArchetypeFindById.mockResolvedValue({ id: 9 });
		mockBroadcastDeckListSourceIsSelectable.mockResolvedValue(true);
		mockFeatureMatchExists.mockResolvedValue(true);
		mockFeatureMatchFindById.mockResolvedValue({ id: 5 });
		mockMatchExists.mockResolvedValue(true);
		mockMatchFindById.mockResolvedValue({ id: 2, roundId: 2 });
		mockPhaseExists.mockResolvedValue(true);
		mockPlayerCountByIds.mockImplementation(async (_eventId: number, ids: number[]) => ids.length);
		mockPlayerListFindById.mockResolvedValue({ id: 7 });
		mockRoundExists.mockResolvedValue(true);
		mockTalentFindById.mockResolvedValue({ id: 3 });
	});

	it('validates Round Phase references within the Event', async () => {
		await expect(requirePhaseInEvent(1, 6)).resolves.toBeUndefined();
		expect(mockPhaseExists).toHaveBeenCalledWith(6, 1);

		await expect(requirePhaseInEvent(1, null)).resolves.toBeUndefined();
		await expect(requirePhaseInEvent(1, undefined)).resolves.toBeUndefined();

		mockPhaseExists.mockResolvedValue(false);
		await expect(requirePhaseInEvent(1, 99)).rejects.toMatchObject({ statusCode: 404, message: 'Phase not found' });
	});

	it('validates player Archetype references', async () => {
		await expect(requireArchetypeInEvent(1, 9)).resolves.toBeUndefined();
		expect(mockArchetypeFindById).toHaveBeenCalledWith(9, 1);
	});

	it('validates commentator Talent references within the Event', async () => {
		await expect(requireTalentInEvent(1, 3)).resolves.toBeUndefined();
		await expect(requireTalentInEvent(1, 4)).resolves.toBeUndefined();

		expect(mockTalentFindById).toHaveBeenCalledWith(3, 1);
		expect(mockTalentFindById).toHaveBeenCalledWith(4, 1);
	});

	it('validates Feature Match Slot Match and Player references', async () => {
		await expect(validateFeatureMatchReferences(1, {
			matchId: 2,
			player1Id: 3,
			player2Id: 3,
		})).resolves.toBeUndefined();

		expect(mockMatchExists).toHaveBeenCalledWith(2, 1);
		expect(mockPlayerCountByIds).toHaveBeenCalledWith(1, [3]);
	});

	it('validates Player List query references', async () => {
		await expect(requirePlayerListInEvent(1, 7)).resolves.toBeUndefined();
		expect(mockPlayerListFindById).toHaveBeenCalledWith(7, 1);
	});

	it('validates Screen Mode data-binding references', async () => {
		await expect(validateScreenModeConfigReferences(1, 'standings', {
			roundId: 2,
			playerListId: 7,
		})).resolves.toBeUndefined();
		await expect(validateScreenModeConfigReferences(1, 'deck', {
			deckSource: { type: 'player', playerId: 3 },
		})).resolves.toBeUndefined();
		await expect(validateScreenModeConfigReferences(1, 'deck', {
			deckSource: { type: 'broadcast', broadcastDeckListId: 8 },
		})).resolves.toBeUndefined();
		await expect(validateScreenModeConfigReferences(1, 'player-history', { playerId: 4 })).resolves.toBeUndefined();
		await expect(validateScreenModeConfigReferences(1, 'feature-match', { featureMatchId: 5 })).resolves.toBeUndefined();

		expect(mockRoundExists).toHaveBeenCalledWith(2, 1);
		expect(mockPlayerListFindById).toHaveBeenCalledWith(7, 1);
		expect(mockPlayerCountByIds).toHaveBeenCalledWith(1, [3]);
		expect(mockBroadcastDeckListSourceIsSelectable).toHaveBeenCalledWith(8, 1);
		expect(mockPlayerCountByIds).toHaveBeenCalledWith(1, [4]);
		expect(mockFeatureMatchExists).toHaveBeenCalledWith(5, 1);
	});

	it('refuses a Broadcast source that is missing, belongs to another Event, or is disabled', async () => {
		mockBroadcastDeckListSourceIsSelectable.mockResolvedValue(false);

		await expect(validateScreenModeConfigReferences(1, 'deck', {
			deckSource: { type: 'broadcast', broadcastDeckListId: 8 },
		})).rejects.toMatchObject({
			statusCode: 409,
			code: 'SCREEN_DECK_SOURCE_CONFLICT',
			message: 'The selected Deck source is no longer available',
		});
	});
});
