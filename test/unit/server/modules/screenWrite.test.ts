import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockScreen } from '~~/test/helpers/fixtures';

const mockValidateScreenModeConfigsReferences = vi.fn();
const mockValidateScreenModeConfigReferences = vi.fn();
const mockScreenService = {
	slugExists: vi.fn(),
	create: vi.fn(),
	findById: vi.fn(),
	update: vi.fn(),
	remove: vi.fn(),
	updateScreenConfig: vi.fn(),
	updateModeConfig: vi.fn(),
};
const mockCardService = {
	cleanupDeletedScreenCard: vi.fn(),
};
const mockPublication = {
	screenCreated: vi.fn(),
	screenUpdated: vi.fn(),
	screenDeleted: vi.fn(),
};

vi.mock('~~/server/utils/routeGuards', () => ({
	validateScreenModeConfigsReferences: mockValidateScreenModeConfigsReferences,
	validateScreenModeConfigReferences: mockValidateScreenModeConfigReferences,
}));

vi.mock('~~/server/services/screen', () => ({
	screenService: () => mockScreenService,
}));

vi.mock('~~/server/services/card', () => ({
	cardService: () => mockCardService,
}));

vi.mock('~~/server/modules/event-data-publication', () => ({
	eventDataPublicationModule: () => mockPublication,
}));

vi.stubGlobal('createError', (input: { statusCode: number; message?: string; statusMessage?: string }) => {
	const error = new Error(input.message ?? input.statusMessage) as Error & { statusCode: number };
	error.statusCode = input.statusCode;
	return error;
});

const { screenWriteModule } = await import('~~/server/modules/screen-write');

describe('screenWriteModule', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockScreenService.slugExists.mockResolvedValue(false);
		mockScreenService.create.mockResolvedValue(createMockScreen({ id: 7, slug: 'main' }));
		mockScreenService.findById.mockResolvedValue(createMockScreen({ id: 7, slug: 'main' }));
		mockScreenService.update.mockResolvedValue(createMockScreen({ id: 7, slug: 'main' }));
		mockScreenService.remove.mockResolvedValue(true);
		mockScreenService.updateScreenConfig.mockResolvedValue(createMockScreen({ id: 7 }));
		mockScreenService.updateModeConfig.mockResolvedValue(createMockScreen({ id: 7 }));
		mockPublication.screenCreated.mockResolvedValue({ id: 7, slug: 'main' });
		mockPublication.screenUpdated.mockResolvedValue({ id: 7, slug: 'main' });
		mockPublication.screenDeleted.mockResolvedValue(undefined);
	});

	describe('createScreen', () => {
		it('validates mode config references before checking the slug', async () => {
			const input = { slug: 'main', modeConfigs: { card: {} } } as never;

			await screenWriteModule().createScreen({ eventId: 1, input, originConnectionId: 'origin-1' });

			expect(mockValidateScreenModeConfigsReferences).toHaveBeenCalledWith(1, { card: {} });
			expect(mockValidateScreenModeConfigsReferences.mock.invocationCallOrder[0])
				.toBeLessThan(mockScreenService.slugExists.mock.invocationCallOrder[0]);
		});

		it('rejects a duplicate slug with a 400 before creating', async () => {
			mockScreenService.slugExists.mockResolvedValue(true);

			await expect(screenWriteModule().createScreen({
				eventId: 1,
				input: { slug: 'taken' } as never,
			})).rejects.toMatchObject({
				statusCode: 400,
				message: 'A screen with this slug already exists',
			});

			expect(mockScreenService.create).not.toHaveBeenCalled();
			expect(mockPublication.screenCreated).not.toHaveBeenCalled();
		});

		it('creates the screen and publishes the mapped response', async () => {
			const input = { slug: 'main' } as never;

			const response = await screenWriteModule().createScreen({ eventId: 1, input, originConnectionId: 'origin-1' });

			expect(mockScreenService.slugExists).toHaveBeenCalledWith(1, 'main');
			expect(mockScreenService.create).toHaveBeenCalledWith(1, input);
			expect(mockPublication.screenCreated).toHaveBeenCalledWith({
				eventId: 1,
				entity: expect.objectContaining({ id: 7, slug: 'main' }),
				originConnectionId: 'origin-1',
			});
			expect(response).toEqual({ id: 7, slug: 'main' });
		});
	});

	describe('updateScreen', () => {
		it('returns 404 when the screen does not exist', async () => {
			mockScreenService.findById.mockResolvedValue(undefined);

			await expect(screenWriteModule().updateScreen({
				eventId: 1,
				screenId: 404,
				input: { stateVersion: 0 } as never,
			})).rejects.toMatchObject({ statusCode: 404, message: 'Screen not found' });

			expect(mockScreenService.update).not.toHaveBeenCalled();
			expect(mockPublication.screenUpdated).not.toHaveBeenCalled();
		});

		it('splits stateVersion from data and forwards it to update', async () => {
			const response = await screenWriteModule().updateScreen({
				eventId: 1,
				screenId: 7,
				input: { stateVersion: 3, slug: 'renamed', modeConfigs: { card: {} } } as never,
				originConnectionId: 'origin-1',
			});

			expect(mockValidateScreenModeConfigsReferences).toHaveBeenCalledWith(1, { card: {} });
			expect(mockScreenService.slugExists).toHaveBeenCalledWith(1, 'renamed', 7);
			expect(mockScreenService.update).toHaveBeenCalledWith(
				7,
				1,
				{ slug: 'renamed', modeConfigs: { card: {} } },
				3,
			);
			expect(mockPublication.screenUpdated).toHaveBeenCalledWith({
				eventId: 1,
				entity: expect.objectContaining({ id: 7 }),
				originConnectionId: 'origin-1',
			});
			expect(response).toEqual({ id: 7, slug: 'main' });
		});

		it('skips the slug uniqueness check when no slug is supplied', async () => {
			await screenWriteModule().updateScreen({
				eventId: 1,
				screenId: 7,
				input: { stateVersion: 0 } as never,
			});

			expect(mockScreenService.slugExists).not.toHaveBeenCalled();
		});

		it('rejects a duplicate slug with a 400', async () => {
			mockScreenService.slugExists.mockResolvedValue(true);

			await expect(screenWriteModule().updateScreen({
				eventId: 1,
				screenId: 7,
				input: { stateVersion: 0, slug: 'taken' } as never,
			})).rejects.toMatchObject({ statusCode: 400 });

			expect(mockScreenService.update).not.toHaveBeenCalled();
		});

		it('returns 404 when the versioned update finds nothing to write', async () => {
			mockScreenService.update.mockResolvedValue(undefined);

			await expect(screenWriteModule().updateScreen({
				eventId: 1,
				screenId: 7,
				input: { stateVersion: 0 } as never,
			})).rejects.toMatchObject({ statusCode: 404, message: 'Screen not found' });

			expect(mockPublication.screenUpdated).not.toHaveBeenCalled();
		});
	});

	describe('deleteScreen', () => {
		it('returns 404 without cleaning up when nothing was deleted', async () => {
			mockScreenService.remove.mockResolvedValue(false);

			await expect(screenWriteModule().deleteScreen({ eventId: 1, screenId: 404 }))
				.rejects
				.toMatchObject({ statusCode: 404, message: 'Screen not found' });

			expect(mockCardService.cleanupDeletedScreenCard).not.toHaveBeenCalled();
			expect(mockPublication.screenDeleted).not.toHaveBeenCalled();
		});

		it('cleans up the derived card after the relational delete, then publishes', async () => {
			const result = await screenWriteModule().deleteScreen({ eventId: 1, screenId: 7, originConnectionId: 'origin-1' });

			expect(mockScreenService.remove.mock.invocationCallOrder[0])
				.toBeLessThan(mockCardService.cleanupDeletedScreenCard.mock.invocationCallOrder[0]);
			expect(mockCardService.cleanupDeletedScreenCard).toHaveBeenCalledWith(1, 7);
			expect(mockPublication.screenDeleted).toHaveBeenCalledWith({
				eventId: 1,
				id: 7,
				originConnectionId: 'origin-1',
			});
			expect(result).toEqual({ success: true });
		});
	});

	describe('updateScreenConfig', () => {
		it('returns 404 when the screen does not exist', async () => {
			mockScreenService.updateScreenConfig.mockResolvedValue(undefined);

			await expect(screenWriteModule().updateScreenConfig({
				eventId: 1,
				screenId: 404,
				config: {},
			})).rejects.toMatchObject({ statusCode: 404, message: 'Screen not found' });

			expect(mockPublication.screenUpdated).not.toHaveBeenCalled();
		});

		it('forwards config and stateVersion, then publishes the update', async () => {
			const response = await screenWriteModule().updateScreenConfig({
				eventId: 1,
				screenId: 7,
				config: { showLogo: false },
				stateVersion: 2,
				originConnectionId: 'origin-1',
			});

			expect(mockScreenService.updateScreenConfig).toHaveBeenCalledWith(7, 1, { showLogo: false }, 2);
			expect(mockPublication.screenUpdated).toHaveBeenCalledWith({
				eventId: 1,
				entity: expect.objectContaining({ id: 7 }),
				originConnectionId: 'origin-1',
			});
			expect(response).toEqual({ id: 7, slug: 'main' });
		});
	});

	describe('updateModeConfig', () => {
		it('validates mode config references before writing', async () => {
			await screenWriteModule().updateModeConfig({
				eventId: 1,
				screenId: 7,
				mode: 'card',
				config: { featureMatchId: 5 },
				stateVersion: 4,
			});

			expect(mockValidateScreenModeConfigReferences).toHaveBeenCalledWith(1, 'card', { featureMatchId: 5 });
			expect(mockValidateScreenModeConfigReferences.mock.invocationCallOrder[0])
				.toBeLessThan(mockScreenService.updateModeConfig.mock.invocationCallOrder[0]);
			expect(mockScreenService.updateModeConfig).toHaveBeenCalledWith(7, 1, 'card', { featureMatchId: 5 }, 4);
		});

		it('returns 404 when the screen does not exist', async () => {
			mockScreenService.updateModeConfig.mockResolvedValue(undefined);

			await expect(screenWriteModule().updateModeConfig({
				eventId: 1,
				screenId: 404,
				mode: 'card',
				config: {},
			})).rejects.toMatchObject({ statusCode: 404, message: 'Screen not found' });

			expect(mockPublication.screenUpdated).not.toHaveBeenCalled();
		});

		it('publishes the mapped response after a successful write', async () => {
			const response = await screenWriteModule().updateModeConfig({
				eventId: 1,
				screenId: 7,
				mode: 'card',
				config: {},
				originConnectionId: 'origin-1',
			});

			expect(mockPublication.screenUpdated).toHaveBeenCalledWith({
				eventId: 1,
				entity: expect.objectContaining({ id: 7 }),
				originConnectionId: 'origin-1',
			});
			expect(response).toEqual({ id: 7, slug: 'main' });
		});
	});
});
