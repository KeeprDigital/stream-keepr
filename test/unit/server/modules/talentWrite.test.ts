import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockTalent } from '~~/test/helpers/fixtures';

const mockTalentService = {
	create: vi.fn(),
	update: vi.fn(),
	remove: vi.fn(),
};
const mockPublication = {
	talentCreated: vi.fn(),
	talentUpdated: vi.fn(),
	talentDeleted: vi.fn(),
};

vi.mock('~~/server/services/talent', () => ({
	talentService: () => mockTalentService,
}));

vi.mock('~~/server/modules/event-data-publication', () => ({
	eventDataPublicationModule: () => mockPublication,
}));

vi.stubGlobal('createError', (input: { statusCode: number; message?: string; statusMessage?: string }) => {
	const error = new Error(input.message ?? input.statusMessage) as Error & { statusCode: number };
	error.statusCode = input.statusCode;
	return error;
});

const { talentWriteModule } = await import('~~/server/modules/talent-write');

describe('talentWriteModule', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockTalentService.create.mockResolvedValue(createMockTalent({ id: 7, name: 'New Caster' }));
		mockTalentService.update.mockResolvedValue(createMockTalent({ id: 7, name: 'Updated Caster' }));
		mockTalentService.remove.mockResolvedValue(true);
		mockPublication.talentCreated.mockResolvedValue({ id: 7, eventId: 1, name: 'New Caster' });
		mockPublication.talentUpdated.mockResolvedValue({ id: 7, eventId: 1, name: 'Updated Caster' });
	});

	it('creates a Talent and publishes the created event', async () => {
		const input = { name: 'New Caster' };

		const response = await talentWriteModule().createTalent({
			eventId: 1,
			input,
			originConnectionId: 'origin-1',
		});

		expect(mockTalentService.create).toHaveBeenCalledWith(1, input);
		expect(mockPublication.talentCreated).toHaveBeenCalledWith({
			eventId: 1,
			entity: expect.objectContaining({ id: 7, name: 'New Caster' }),
			originConnectionId: 'origin-1',
		});
		expect(response).toEqual({ id: 7, eventId: 1, name: 'New Caster' });
	});

	it('updates a Talent and publishes the updated event', async () => {
		const input = { name: 'Updated Caster' };

		const response = await talentWriteModule().updateTalent({
			eventId: 1,
			talentId: 7,
			input,
			originConnectionId: 'origin-1',
		});

		expect(mockTalentService.update).toHaveBeenCalledWith(7, 1, input);
		expect(mockPublication.talentUpdated).toHaveBeenCalledWith({
			eventId: 1,
			entity: expect.objectContaining({ id: 7, name: 'Updated Caster' }),
			originConnectionId: 'origin-1',
		});
		expect(response).toEqual({ id: 7, eventId: 1, name: 'Updated Caster' });
	});

	it('returns 404 when talentService.update returns undefined', async () => {
		mockTalentService.update.mockResolvedValue(undefined);

		await expect(talentWriteModule().updateTalent({
			eventId: 1,
			talentId: 404,
			input: { name: 'Missing Caster' },
		})).rejects.toMatchObject({
			statusCode: 404,
			message: 'Talent not found',
		});

		expect(mockPublication.talentUpdated).not.toHaveBeenCalled();
	});

	it('deletes a Talent and publishes the deleted event', async () => {
		const response = await talentWriteModule().deleteTalent({
			eventId: 1,
			talentId: 7,
			originConnectionId: 'origin-1',
		});

		expect(mockTalentService.remove).toHaveBeenCalledWith(7, 1);
		expect(mockPublication.talentDeleted).toHaveBeenCalledWith({
			eventId: 1,
			id: 7,
			originConnectionId: 'origin-1',
		});
		expect(response).toEqual({ success: true });
	});

	it('returns 404 when talentService.remove returns false', async () => {
		mockTalentService.remove.mockResolvedValue(false);

		await expect(talentWriteModule().deleteTalent({
			eventId: 1,
			talentId: 404,
		})).rejects.toMatchObject({
			statusCode: 404,
			message: 'Talent not found',
		});

		expect(mockPublication.talentDeleted).not.toHaveBeenCalled();
	});
});
