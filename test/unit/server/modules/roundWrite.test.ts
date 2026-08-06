import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockRound } from '~~/test/helpers/fixtures';

const mockRequirePhaseInEvent = vi.fn();
const mockRoundService = {
	create: vi.fn(),
	update: vi.fn(),
	remove: vi.fn(),
};
const mockPublication = {
	roundCreated: vi.fn(),
	roundUpdated: vi.fn(),
	roundDeleted: vi.fn(),
};

vi.mock('~~/server/utils/routeGuards', () => ({
	requirePhaseInEvent: mockRequirePhaseInEvent,
}));

vi.mock('~~/server/services/round', () => ({
	roundService: () => mockRoundService,
}));

vi.mock('~~/server/modules/event-data-publication', () => ({
	eventDataPublicationModule: () => mockPublication,
}));

vi.stubGlobal('createError', (input: { statusCode: number; message?: string; statusMessage?: string }) => {
	const error = new Error(input.message ?? input.statusMessage) as Error & { statusCode: number };
	error.statusCode = input.statusCode;
	return error;
});

const { roundWriteModule } = await import('~~/server/modules/round-write');

describe('roundWriteModule', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRoundService.create.mockResolvedValue(createMockRound({ id: 4, phaseId: 2 }));
		mockRoundService.update.mockResolvedValue(createMockRound({ id: 4, phaseId: 2 }));
		mockRoundService.remove.mockResolvedValue(true);
		mockPublication.roundCreated.mockResolvedValue({ id: 4, phaseId: 2 });
		mockPublication.roundUpdated.mockResolvedValue({ id: 4, phaseId: 2 });
		mockPublication.roundDeleted.mockResolvedValue(undefined);
	});

	it('validates the Phase reference before create', async () => {
		const input = { phaseId: 2, name: 'Round 1', roundNumber: 1 };

		const response = await roundWriteModule().create({
			eventId: 1,
			input,
			originConnectionId: 'origin-1',
		});

		expect(mockRequirePhaseInEvent).toHaveBeenCalledWith(1, 2);
		expect(mockRequirePhaseInEvent.mock.invocationCallOrder[0])
			.toBeLessThan(mockRoundService.create.mock.invocationCallOrder[0]!);
		expect(mockRoundService.create).toHaveBeenCalledWith(1, input);
		expect(mockPublication.roundCreated).toHaveBeenCalledWith({
			eventId: 1,
			entity: expect.objectContaining({ id: 4 }),
			originConnectionId: 'origin-1',
		});
		expect(response).toEqual({ id: 4, phaseId: 2 });
	});

	it('validates the Phase reference before update and publishes the result', async () => {
		const input = { phaseId: 2, name: 'Renamed Round' };

		const response = await roundWriteModule().update({
			eventId: 1,
			roundId: 4,
			input,
			originConnectionId: 'origin-1',
		});

		expect(mockRequirePhaseInEvent).toHaveBeenCalledWith(1, 2);
		expect(mockRoundService.update).toHaveBeenCalledWith(4, 1, input);
		expect(mockPublication.roundUpdated).toHaveBeenCalledWith({
			eventId: 1,
			entity: expect.objectContaining({ id: 4 }),
			originConnectionId: 'origin-1',
		});
		expect(response).toEqual({ id: 4, phaseId: 2 });
	});

	it('returns 404 when roundService.update returns undefined', async () => {
		mockRoundService.update.mockResolvedValue(undefined);

		await expect(roundWriteModule().update({
			eventId: 1,
			roundId: 404,
			input: {},
		})).rejects.toMatchObject({
			statusCode: 404,
			message: 'Round not found',
		});

		expect(mockPublication.roundUpdated).not.toHaveBeenCalled();
	});

	it('publishes deletion when a Round is removed', async () => {
		await roundWriteModule().remove({
			eventId: 1,
			roundId: 4,
			originConnectionId: 'origin-1',
		});

		expect(mockRoundService.remove).toHaveBeenCalledWith(4, 1);
		expect(mockPublication.roundDeleted).toHaveBeenCalledWith({
			eventId: 1,
			id: 4,
			originConnectionId: 'origin-1',
		});
	});

	it('returns 404 when roundService.remove reports nothing deleted', async () => {
		mockRoundService.remove.mockResolvedValue(false);

		await expect(roundWriteModule().remove({
			eventId: 1,
			roundId: 404,
		})).rejects.toMatchObject({
			statusCode: 404,
			message: 'Round not found',
		});

		expect(mockPublication.roundDeleted).not.toHaveBeenCalled();
	});
});
