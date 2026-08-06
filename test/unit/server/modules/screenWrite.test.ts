import { beforeEach, describe, expect, it, vi } from 'vitest';
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
const mockGraphicsAssets = {
	inspectGraphicAssetRevision: vi.fn(),
};

/**
 * The collaborators as a route hands them over: thunks, invoked by the operation
 * at the point of use rather than by the caller.
 *
 * `vi.fn()` wrappers rather than bare arrows because *whether* an operation
 * builds a collaborator is itself part of what this module promises — building
 * the capability manager reads a signing key and fails without it (#233), so a
 * write refused before it needs one must not ask. See #247.
 */
const provideScreenOutputAssetCapabilities = vi.fn(() => mockScreenOutputAssetCapabilities);
const provideGraphicsAssets = vi.fn(() => mockGraphicsAssets);
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

// `cause` is carried because it is what survives the 5xx sanitizer, and a stub
// that dropped it would let a masked failure pass. Nothing here raises one since
// #247 deleted this module's wiring faults, but the module's other errors are
// mapped by the same hook.
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

			await expect(screenWriteModule().createScreen({
				eventId: 1,
				input: {
					name: 'Overlay',
					slug: 'overlay',
					modeConfigs: { 'feature-match-overlay': config },
				} as never,
				screenOutputAssetCapabilities: provideScreenOutputAssetCapabilities,
			})).rejects.toMatchObject({
				statusCode: 400,
				message: expect.stringContaining('Screen Mode configuration endpoint'),
			});
			expect(mockScreenService.create).not.toHaveBeenCalled();
		});

		it('validates mode config references before checking the slug', async () => {
			const input = { slug: 'main', modeConfigs: { card: {} } } as never;

			await screenWriteModule().createScreen({
				eventId: 1,
				input,
				originConnectionId: 'origin-1',
				screenOutputAssetCapabilities: provideScreenOutputAssetCapabilities,
			});

			expect(mockValidateScreenModeConfigsReferences).toHaveBeenCalledWith(1, { card: {} });
			expect(mockValidateScreenModeConfigsReferences.mock.invocationCallOrder[0])
				.toBeLessThan(mockScreenService.slugExists.mock.invocationCallOrder[0]);
		});

		it('rejects a duplicate slug with a 400 before creating', async () => {
			mockScreenService.slugExists.mockResolvedValue(true);

			await expect(screenWriteModule().createScreen({
				eventId: 1,
				input: { slug: 'taken' } as never,
				screenOutputAssetCapabilities: provideScreenOutputAssetCapabilities,
			})).rejects.toMatchObject({
				statusCode: 400,
				message: 'A screen with this slug already exists',
			});

			expect(mockScreenService.create).not.toHaveBeenCalled();
			expect(mockPublication.screenCreated).not.toHaveBeenCalled();
			// Nothing built the capability manager. Building one reads the Screen
			// Output capability signing key and refuses without it (#233), so a
			// create refused for its own slug must not report a missing setting
			// instead. The thunk is what makes that true. See #247.
			expect(provideScreenOutputAssetCapabilities).not.toHaveBeenCalled();
		});

		it('creates the screen and publishes the mapped response', async () => {
			const input = { slug: 'main' } as never;

			const response = await screenWriteModule().createScreen({
				eventId: 1,
				input,
				originConnectionId: 'origin-1',
				screenOutputAssetCapabilities: provideScreenOutputAssetCapabilities,
			});

			expect(provideScreenOutputAssetCapabilities).toHaveBeenCalledTimes(1);
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

		// The message is asserted, not just the status. `createScreen`'s refusal is
		// byte-identical to this one and was already pinned, so a mutation here was
		// invisible: the suite stayed green with `updateScreen` refusing in words
		// nobody had agreed to. See #248.
		it('rejects a duplicate slug with a 400', async () => {
			mockScreenService.slugExists.mockResolvedValue(true);

			await expect(screenWriteModule().updateScreen({
				eventId: 1,
				screenId: 7,
				input: { stateVersion: 0, slug: 'taken' } as never,
			})).rejects.toMatchObject({
				statusCode: 400,
				message: 'A screen with this slug already exists',
			});

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

			await screenWriteModule().updateModeConfig({
				eventId: 1,
				screenId: 7,
				mode: 'feature-match-overlay',
				config: { layout: config.layout },
				graphicsAssets: () => ({ inspectGraphicAssetRevision }),
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

			await expect(screenWriteModule().updateModeConfig({
				eventId: 1,
				screenId: 7,
				mode: 'feature-match-overlay',
				config: { layout: config.layout },
				graphicsAssets: () => ({
					inspectGraphicAssetRevision: vi.fn().mockResolvedValue({
						outcome: 'unavailable',
						retryable: true,
					}),
				}),
			})).rejects.toMatchObject({
				statusCode: 409,
				message: expect.stringContaining('layout.frame.backgroundImage'),
			});

			expect(mockScreenService.updateModeConfig).not.toHaveBeenCalled();
		});

		// The two laziness pins below. This operation serves all ten Screen Modes
		// and its route builds the library for every one of them, so requiring the
		// collaborator at the type level is only safe while building it stays
		// deferred to the write that actually asks a question. See #247.
		it('does not build the Graphics Asset Library for a Screen Mode that pins no references', async () => {
			await screenWriteModule().updateModeConfig({
				eventId: 1,
				screenId: 7,
				mode: 'card',
				config: { featureMatchId: 5 },
				graphicsAssets: provideGraphicsAssets,
			});

			expect(mockScreenService.updateModeConfig).toHaveBeenCalled();
			expect(provideGraphicsAssets).not.toHaveBeenCalled();
		});

		it('does not build the Graphics Asset Library when no Graphic Asset Reference changed', async () => {
			const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
			config.layout.frame.backgroundImage = {
				assetId: 'asset-1',
				revisionId: 'revision-1',
			};
			mockScreenService.findById.mockResolvedValue(createMockScreen({
				id: 7,
				modeConfigs: { 'feature-match-overlay': config },
			}));

			await screenWriteModule().updateModeConfig({
				eventId: 1,
				screenId: 7,
				mode: 'feature-match-overlay',
				config: { layout: config.layout },
				graphicsAssets: provideGraphicsAssets,
			});

			// A pinned revision keeps resolving after its asset is retired, so an
			// unchanged reference is deliberately never re-checked — and a write that
			// asks nothing must not build the thing it would have asked.
			expect(mockScreenService.updateModeConfig).toHaveBeenCalled();
			expect(provideGraphicsAssets).not.toHaveBeenCalled();
			expect(mockGraphicsAssets.inspectGraphicAssetRevision).not.toHaveBeenCalled();

			// The control the assertion above needs: the same submission with the
			// revision moved does build one. Without it this test would pass just as
			// happily if the reference were never discovered in the merged
			// configuration at all.
			mockGraphicsAssets.inspectGraphicAssetRevision.mockResolvedValue({
				outcome: 'available',
				lifecycleState: 'active',
				kind: 'image',
			});
			const moved = structuredClone(config);
			moved.layout.frame.backgroundImage = {
				assetId: 'asset-1',
				revisionId: 'revision-2',
			};

			await screenWriteModule().updateModeConfig({
				eventId: 1,
				screenId: 7,
				mode: 'feature-match-overlay',
				config: { layout: moved.layout },
				graphicsAssets: provideGraphicsAssets,
			});

			expect(provideGraphicsAssets).toHaveBeenCalledTimes(1);
			expect(mockGraphicsAssets.inspectGraphicAssetRevision).toHaveBeenCalledWith({
				assetId: 'asset-1',
				revisionId: 'revision-2',
			});
		});

		it('validates mode config references before writing', async () => {
			await screenWriteModule().updateModeConfig({
				eventId: 1,
				screenId: 7,
				mode: 'card',
				config: { featureMatchId: 5 },
				stateVersion: 4,
				graphicsAssets: provideGraphicsAssets,
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
				graphicsAssets: provideGraphicsAssets,
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
				graphicsAssets: provideGraphicsAssets,
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
