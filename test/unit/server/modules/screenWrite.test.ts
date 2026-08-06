import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceWiringError } from '~~/server/utils/errors';
import { mapPublicNitroError } from '~~/server/utils/nitroErrorMapping';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';
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
const mockScreenOutputAssetCapabilities = {
	prepare: vi.fn(),
};
const mockBroadcastGraphicsLiveSessions = {
	endSessionsForScreen: vi.fn(),
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

vi.mock('~~/server/modules/broadcast-graphics-live-session', () => ({
	broadcastGraphicsLiveSessionModule: () => mockBroadcastGraphicsLiveSessions,
}));

// `cause` is carried because it is what survives the 5xx sanitizer: a stub that
// drops it would let a masked failure pass these tests. See #243.
vi.stubGlobal('createError', (input: { statusCode: number; message?: string; statusMessage?: string; cause?: unknown }) => {
	const error = new Error(input.message ?? input.statusMessage, { cause: input.cause }) as Error & {
		statusCode: number;
		statusMessage?: string;
	};
	error.statusCode = input.statusCode;
	error.statusMessage = input.statusMessage;
	return error;
});

const { screenWriteModule } = await import('~~/server/modules/screen-write');

/**
 * What an operator actually receives: the module's error after the Nitro error
 * plugin has mapped it.
 *
 * Asserting the thrown error on its own would pass even with the cause dropped,
 * because the rewrite to 'Internal Server Error' happens in the mapper and
 * nowhere else — which is the entirety of #243.
 */
async function publicErrorFor(operation: Promise<unknown>) {
	const thrown = await operation.then(
		() => null,
		(error: unknown) => error as Error & { statusCode: number; statusMessage?: string },
	);
	if (!thrown)
		throw new Error('expected the operation to reject, and it resolved');
	mapPublicNitroError(thrown);
	return thrown;
}

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
		mockScreenOutputAssetCapabilities.prepare.mockResolvedValue({
			capability: 'opaque-capability',
			persisted: {
				assetCapabilitySeed: 'seed-1',
				assetCapabilityVersion: 1,
				assetCapabilityDigest: 'digest-1',
			},
		});
	});

	describe('createScreen', () => {
		it('rejects Graphic Asset References through a generic Screen write that cannot index them', async () => {
			const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
			config.layout.frame.backgroundImage = {
				assetId: 'asset-1',
				revisionId: 'revision-1',
			};

			await expect(screenWriteModule({
				screenOutputAssetCapabilities: mockScreenOutputAssetCapabilities,
			}).createScreen({
				eventId: 1,
				input: {
					name: 'Overlay',
					slug: 'overlay',
					modeConfigs: { 'feature-match-overlay': config },
				} as never,
			})).rejects.toMatchObject({
				statusCode: 400,
				message: expect.stringContaining('Screen Mode configuration endpoint'),
			});
			expect(mockScreenService.create).not.toHaveBeenCalled();
		});

		it('names the dependency it was not given rather than answering a bare 503', async () => {
			const failure = await publicErrorFor(screenWriteModule().createScreen({
				eventId: 1,
				input: { name: 'Main', slug: 'main' } as never,
			}));

			expect(failure.cause).toBeInstanceOf(ServiceWiringError);
			expect(failure).toMatchObject({
				statusCode: 503,
				statusMessage: 'Service Unavailable',
				message: expect.stringContaining('Screen Output asset capabilities'),
			});
			expect(mockScreenService.create).not.toHaveBeenCalled();
		});

		it('validates mode config references before checking the slug', async () => {
			const input = { slug: 'main', modeConfigs: { card: {} } } as never;

			await screenWriteModule({
				screenOutputAssetCapabilities: mockScreenOutputAssetCapabilities,
			}).createScreen({ eventId: 1, input, originConnectionId: 'origin-1' });

			expect(mockValidateScreenModeConfigsReferences).toHaveBeenCalledWith(1, { card: {} });
			expect(mockValidateScreenModeConfigsReferences.mock.invocationCallOrder[0])
				.toBeLessThan(mockScreenService.slugExists.mock.invocationCallOrder[0]);
		});

		it('rejects a duplicate slug with a 400 before creating', async () => {
			mockScreenService.slugExists.mockResolvedValue(true);

			await expect(screenWriteModule({
				screenOutputAssetCapabilities: mockScreenOutputAssetCapabilities,
			}).createScreen({
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

			const response = await screenWriteModule({
				screenOutputAssetCapabilities: mockScreenOutputAssetCapabilities,
			}).createScreen({ eventId: 1, input, originConnectionId: 'origin-1' });

			expect(mockScreenService.slugExists).toHaveBeenCalledWith(1, 'main');
			expect(mockScreenService.create).toHaveBeenCalledWith(
				1,
				input,
				{
					assetCapabilitySeed: 'seed-1',
					assetCapabilityVersion: 1,
					assetCapabilityDigest: 'digest-1',
				},
			);
			expect(mockPublication.screenCreated).toHaveBeenCalledWith({
				eventId: 1,
				entity: expect.objectContaining({ id: 7, slug: 'main' }),
				originConnectionId: 'origin-1',
			});
			expect(response).toEqual({
				id: 7,
				slug: 'main',
			});
		});
	});

	describe('updateScreen', () => {
		it('rejects removing indexed Graphic Asset References through the generic Screen endpoint', async () => {
			const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
			config.layout.frame.backgroundImage = {
				assetId: 'asset-1',
				revisionId: 'revision-1',
			};
			mockScreenService.findById.mockResolvedValue(createMockScreen({
				modeConfigs: { 'feature-match-overlay': config },
			}));

			await expect(screenWriteModule().updateScreen({
				eventId: 1,
				screenId: 7,
				input: { stateVersion: 0, modeConfigs: null } as never,
			})).rejects.toMatchObject({
				statusCode: 400,
				message: expect.stringContaining('Screen Mode configuration endpoint'),
			});

			expect(mockScreenService.update).not.toHaveBeenCalled();
		});

		it('allows generic Screen metadata edits that submit unchanged Graphic Asset References', async () => {
			const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
			config.layout.frame.backgroundImage = {
				assetId: 'asset-1',
				revisionId: 'revision-1',
			};
			mockScreenService.findById.mockResolvedValue(createMockScreen({
				modeConfigs: { 'feature-match-overlay': config },
			}));

			await screenWriteModule().updateScreen({
				eventId: 1,
				screenId: 7,
				input: {
					stateVersion: 0,
					name: 'Renamed overlay',
					modeConfigs: { 'feature-match-overlay': config },
				} as never,
			});

			expect(mockScreenService.update).toHaveBeenCalled();
		});

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

		it('ends the Broadcast Graphics Live Session when the Screen leaves the mode', async () => {
			mockScreenService.findById.mockResolvedValue(createMockScreen({ id: 7, slug: 'main', currentMode: 'broadcast-graphics' }));
			mockScreenService.update.mockResolvedValue(createMockScreen({ id: 7, slug: 'main', currentMode: 'idle' }));

			await screenWriteModule().updateScreen({
				eventId: 1,
				screenId: 7,
				input: { stateVersion: 0, currentMode: 'idle' } as never,
			});

			// The epoch ends only once the mode change is committed, so a failed
			// update can never orphan a running show's live state.
			expect(mockScreenService.update.mock.invocationCallOrder[0])
				.toBeLessThan(mockBroadcastGraphicsLiveSessions.endSessionsForScreen.mock.invocationCallOrder[0]!);
			// Announced. Not because outputs would otherwise keep rendering the ended
			// show — `screen:updated` already reaches them and they render by the
			// Screen's current mode — but so that each peer drops the ended epoch's
			// cached state deterministically rather than on a component remount.
			expect(mockBroadcastGraphicsLiveSessions.endSessionsForScreen).toHaveBeenCalledWith(
				7,
				1,
				{ notify: true, originConnectionId: undefined },
			);
		});

		it('leaves the Live Session running while the Screen stays in Broadcast Graphics mode', async () => {
			mockScreenService.findById.mockResolvedValue(createMockScreen({ id: 7, slug: 'main', currentMode: 'broadcast-graphics' }));
			mockScreenService.update.mockResolvedValue(createMockScreen({ id: 7, slug: 'main', currentMode: 'broadcast-graphics' }));

			await screenWriteModule().updateScreen({
				eventId: 1,
				screenId: 7,
				input: { stateVersion: 0, name: 'Renamed' } as never,
			});

			expect(mockBroadcastGraphicsLiveSessions.endSessionsForScreen).not.toHaveBeenCalled();
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

		it('ends any playout epoch before deleting the Screen, so its receipts are discarded', async () => {
			mockScreenService.findById.mockResolvedValue(createMockScreen({ id: 7, slug: 'main', currentMode: 'broadcast-graphics' }));

			await screenWriteModule().deleteScreen({ eventId: 1, screenId: 7 });

			// The cascade delete removes the sessions, after which nothing identifies
			// the receipts they left behind — so ending has to come first here, the
			// opposite order from a mode change.
			expect(mockBroadcastGraphicsLiveSessions.endSessionsForScreen.mock.invocationCallOrder[0]!)
				.toBeLessThan(mockScreenService.remove.mock.invocationCallOrder[0]!);
			// Unannounced, unlike a mode change: these clients are about to be told the
			// Screen itself is gone, and pointing them at a snapshot route that will now
			// refuse them would surface a spurious failure on the way out.
			expect(mockBroadcastGraphicsLiveSessions.endSessionsForScreen).toHaveBeenCalledWith(7, 1);
		});

		it('does not touch playout state when deleting a Screen that was never in Broadcast Graphics mode', async () => {
			mockScreenService.findById.mockResolvedValue(createMockScreen({ id: 7, slug: 'main', currentMode: 'idle' }));

			await screenWriteModule().deleteScreen({ eventId: 1, screenId: 7 });

			expect(mockBroadcastGraphicsLiveSessions.endSessionsForScreen).not.toHaveBeenCalled();
			expect(mockScreenService.remove).toHaveBeenCalledWith(7, 1);
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
		it('checks newly selected Graphic Asset Revisions through the library before writing', async () => {
			const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
			config.layout.frame.backgroundImage = {
				assetId: 'asset-1',
				revisionId: 'revision-1',
			};
			const inspectGraphicAssetRevision = vi.fn().mockResolvedValue({
				outcome: 'available',
				lifecycleState: 'active',
				kind: 'image',
			});

			await screenWriteModule({
				graphicsAssets: { inspectGraphicAssetRevision },
			}).updateModeConfig({
				eventId: 1,
				screenId: 7,
				mode: 'feature-match-overlay',
				config: { layout: config.layout },
			});

			expect(inspectGraphicAssetRevision).toHaveBeenCalledWith({
				assetId: 'asset-1',
				revisionId: 'revision-1',
			});
			expect(mockScreenService.updateModeConfig).toHaveBeenCalled();
		});

		it('rejects a newly selected unavailable Graphic Asset Revision before writing', async () => {
			const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
			config.layout.frame.backgroundImage = {
				assetId: 'asset-1',
				revisionId: 'revision-1',
			};

			await expect(screenWriteModule({
				graphicsAssets: {
					inspectGraphicAssetRevision: vi.fn().mockResolvedValue({
						outcome: 'unavailable',
						retryable: true,
					}),
				},
			}).updateModeConfig({
				eventId: 1,
				screenId: 7,
				mode: 'feature-match-overlay',
				config: { layout: config.layout },
			})).rejects.toMatchObject({
				statusCode: 409,
				message: expect.stringContaining('layout.frame.backgroundImage'),
			});

			expect(mockScreenService.updateModeConfig).not.toHaveBeenCalled();
		});

		it('names the missing Graphics Asset Library rather than answering a bare 503', async () => {
			const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
			config.layout.frame.backgroundImage = {
				assetId: 'asset-1',
				revisionId: 'revision-1',
			};

			const failure = await publicErrorFor(screenWriteModule().updateModeConfig({
				eventId: 1,
				screenId: 7,
				mode: 'feature-match-overlay',
				config: { layout: config.layout },
			}));

			expect(failure.cause).toBeInstanceOf(ServiceWiringError);
			expect(failure).toMatchObject({
				statusCode: 503,
				statusMessage: 'Service Unavailable',
				message: expect.stringContaining('Graphics Asset Library'),
			});
			expect(mockScreenService.updateModeConfig).not.toHaveBeenCalled();
		});

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
