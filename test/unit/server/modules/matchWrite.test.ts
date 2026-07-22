import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockMatch } from '~~/test/helpers/fixtures';

const mockRequireRoundInEvent = vi.fn();
const mockRequirePlayersInEvent = vi.fn();
const mockMatchService = {
	create: vi.fn(),
	update: vi.fn(),
	remove: vi.fn(),
};
const mockPublication = {
	matchCreated: vi.fn(),
	matchUpdated: vi.fn(),
	matchDeleted: vi.fn(),
};

vi.mock('~~/server/utils/routeGuards', () => ({
	requireRoundInEvent: mockRequireRoundInEvent,
	requirePlayersInEvent: mockRequirePlayersInEvent,
}));

vi.mock('~~/server/services/match', () => ({
	matchService: () => mockMatchService,
}));

vi.mock('~~/server/modules/event-data-publication', () => ({
	eventDataPublicationModule: () => mockPublication,
}));

vi.stubGlobal('createError', (input: { statusCode: number; message?: string; statusMessage?: string }) => {
	const error = new Error(input.message ?? input.statusMessage) as Error & { statusCode: number };
	error.statusCode = input.statusCode;
	return error;
});

const { matchWriteModule } = await import('~~/server/modules/match-write');

describe('matchWriteModule', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockMatchService.create.mockResolvedValue(createMockMatch({ id: 7, roundId: 3 }));
		mockMatchService.update.mockResolvedValue(createMockMatch({ id: 7, roundId: 3 }));
		mockMatchService.remove.mockResolvedValue(true);
		mockPublication.matchCreated.mockResolvedValue({ id: 7, roundId: 3 });
		mockPublication.matchUpdated.mockResolvedValue({ id: 7, roundId: 3 });
		mockPublication.matchDeleted.mockResolvedValue(undefined);
	});

	it('validates Round and Player references before create', async () => {
		const input = { roundId: 3, player1Id: 10, player2Id: 11 };

		const response = await matchWriteModule().create({
			eventId: 1,
			input,
			originConnectionId: 'origin-1',
		});

		expect(mockRequireRoundInEvent).toHaveBeenCalledWith(1, 3);
		expect(mockRequirePlayersInEvent).toHaveBeenCalledWith(1, [10, 11]);
		expect(mockRequireRoundInEvent.mock.invocationCallOrder[0])
			.toBeLessThan(mockRequirePlayersInEvent.mock.invocationCallOrder[0]);
		expect(mockRequirePlayersInEvent.mock.invocationCallOrder[0])
			.toBeLessThan(mockMatchService.create.mock.invocationCallOrder[0]);
		expect(mockMatchService.create).toHaveBeenCalledWith(1, input);
		expect(mockPublication.matchCreated).toHaveBeenCalledWith({
			eventId: 1,
			entity: expect.objectContaining({ id: 7 }),
			originConnectionId: 'origin-1',
		});
		expect(response).toEqual({ id: 7, roundId: 3 });
	});

	it('validates references before update and publishes the result', async () => {
		const input = { roundId: 3, player1Id: 10, player2Id: 11 };

		const response = await matchWriteModule().update({
			eventId: 1,
			matchId: 7,
			input,
			originConnectionId: 'origin-1',
		});

		expect(mockRequireRoundInEvent).toHaveBeenCalledWith(1, 3);
		expect(mockRequirePlayersInEvent).toHaveBeenCalledWith(1, [10, 11]);
		expect(mockMatchService.update).toHaveBeenCalledWith(7, 1, input);
		expect(mockPublication.matchUpdated).toHaveBeenCalledWith({
			eventId: 1,
			entity: expect.objectContaining({ id: 7 }),
			originConnectionId: 'origin-1',
		});
		expect(response).toEqual({ id: 7, roundId: 3 });
	});

	it('returns 404 when matchService.update returns undefined', async () => {
		mockMatchService.update.mockResolvedValue(undefined);

		await expect(matchWriteModule().update({
			eventId: 1,
			matchId: 404,
			input: {},
		})).rejects.toMatchObject({
			statusCode: 404,
			message: 'Match not found',
		});

		expect(mockPublication.matchUpdated).not.toHaveBeenCalled();
	});

	it('publishes deletion when a Match is removed', async () => {
		await matchWriteModule().remove({
			eventId: 1,
			matchId: 7,
			originConnectionId: 'origin-1',
		});

		expect(mockMatchService.remove).toHaveBeenCalledWith(7, 1);
		expect(mockPublication.matchDeleted).toHaveBeenCalledWith({
			eventId: 1,
			id: 7,
			originConnectionId: 'origin-1',
		});
	});

	it('returns 404 when matchService.remove reports nothing deleted', async () => {
		mockMatchService.remove.mockResolvedValue(false);

		await expect(matchWriteModule().remove({
			eventId: 1,
			matchId: 404,
		})).rejects.toMatchObject({
			statusCode: 404,
			message: 'Match not found',
		});

		expect(mockPublication.matchDeleted).not.toHaveBeenCalled();
	});
});
