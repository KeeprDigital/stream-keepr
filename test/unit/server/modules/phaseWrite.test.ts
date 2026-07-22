import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockPhase } from '~~/test/helpers/fixtures';

const mockPhaseService = {
	create: vi.fn(),
	update: vi.fn(),
	remove: vi.fn(),
};
const mockPublication = {
	phaseCreated: vi.fn(),
	phaseUpdated: vi.fn(),
	phaseDeleted: vi.fn(),
};

vi.mock('~~/server/services/phase', () => ({
	phaseService: () => mockPhaseService,
}));

vi.mock('~~/server/modules/event-data-publication', () => ({
	eventDataPublicationModule: () => mockPublication,
}));

vi.stubGlobal('createError', (input: { statusCode: number; message?: string; statusMessage?: string }) => {
	const error = new Error(input.message ?? input.statusMessage) as Error & { statusCode: number };
	error.statusCode = input.statusCode;
	return error;
});

const { phaseWriteModule } = await import('~~/server/modules/phase-write');

describe('phaseWriteModule', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockPhaseService.create.mockResolvedValue(createMockPhase({ id: 6, name: 'Swiss' }));
		mockPhaseService.update.mockResolvedValue(createMockPhase({ id: 6, name: 'Swiss' }));
		mockPhaseService.remove.mockResolvedValue(true);
		mockPublication.phaseCreated.mockResolvedValue({ id: 6, name: 'Swiss' });
		mockPublication.phaseUpdated.mockResolvedValue({ id: 6, name: 'Swiss' });
		mockPublication.phaseDeleted.mockResolvedValue(undefined);
	});

	it('creates a Phase and publishes the result', async () => {
		const input = { name: 'Swiss', sortOrder: 0 };

		const response = await phaseWriteModule().create({
			eventId: 1,
			input,
			originConnectionId: 'origin-1',
		});

		expect(mockPhaseService.create).toHaveBeenCalledWith(1, input);
		expect(mockPublication.phaseCreated).toHaveBeenCalledWith({
			eventId: 1,
			entity: expect.objectContaining({ id: 6 }),
			originConnectionId: 'origin-1',
		});
		expect(response).toEqual({ id: 6, name: 'Swiss' });
	});

	it('updates a Phase and publishes the result', async () => {
		const input = { name: 'Top 8' };

		const response = await phaseWriteModule().update({
			eventId: 1,
			phaseId: 6,
			input,
			originConnectionId: 'origin-1',
		});

		expect(mockPhaseService.update).toHaveBeenCalledWith(6, 1, input);
		expect(mockPublication.phaseUpdated).toHaveBeenCalledWith({
			eventId: 1,
			entity: expect.objectContaining({ id: 6 }),
			originConnectionId: 'origin-1',
		});
		expect(response).toEqual({ id: 6, name: 'Swiss' });
	});

	it('returns 404 when phaseService.update returns undefined', async () => {
		mockPhaseService.update.mockResolvedValue(undefined);

		await expect(phaseWriteModule().update({
			eventId: 1,
			phaseId: 404,
			input: {},
		})).rejects.toMatchObject({
			statusCode: 404,
			message: 'Phase not found',
		});

		expect(mockPublication.phaseUpdated).not.toHaveBeenCalled();
	});

	it('publishes deletion when a Phase is removed', async () => {
		await phaseWriteModule().remove({
			eventId: 1,
			phaseId: 6,
			originConnectionId: 'origin-1',
		});

		expect(mockPhaseService.remove).toHaveBeenCalledWith(6, 1);
		expect(mockPublication.phaseDeleted).toHaveBeenCalledWith({
			eventId: 1,
			id: 6,
			originConnectionId: 'origin-1',
		});
	});

	it('returns 404 when phaseService.remove reports nothing deleted', async () => {
		mockPhaseService.remove.mockResolvedValue(false);

		await expect(phaseWriteModule().remove({
			eventId: 1,
			phaseId: 404,
		})).rejects.toMatchObject({
			statusCode: 404,
			message: 'Phase not found',
		});

		expect(mockPublication.phaseDeleted).not.toHaveBeenCalled();
	});
});
