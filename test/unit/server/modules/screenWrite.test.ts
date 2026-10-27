import { beforeEach, describe, expect, it, vi } from 'vitest';
import { graphicAssetId, graphicAssetRevisionId } from '~~/server/modules/graphics-asset-library';
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
	inspectGraphicAssetRevisions: vi.fn(),
};

// Collaborators arrive as thunks; whether an operation builds one is part of the
// contract, since building the capability manager needs a signing key (#233).
const provideScreenOutputAssetCapabilities = vi.fn(() => mockScreenOutputAssetCapabilities);
const provideGraphicsAssets = vi.fn(() => mockGraphicsAssets);
/** Stands in for the statements the epoch end asks to ride with the mode change. */
const epochEndStatements = ['end-epoch', 'forget-receipts', 'clear-references'];
const announceEpochEnded = vi.fn();
const mockBroadcastGraphicsLiveSessions = {
	endSessionsForScreen: vi.fn(),
	endEpochOnLeavingBroadcastGraphics: vi.fn(async () => ({
		statements: epochEndStatements,
		announceEnded: announceEpochEnded,
	})),
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

vi.stubGlobal('createError', (input: { statusCode: number; message?: string; statusMessage?: string }) =>
	Object.assign(new Error(input.message ?? input.statusMessage), { statusCode: input.statusCode }));

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
				kind: 'asset',
				assetId: graphicAssetId('asset-1'),
				revisionId: graphicAssetRevisionId('revision-1'),
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

		it('refuses a mode config naming a reference outside the Event before creating', async () => {
			mockValidateScreenModeConfigsReferences.mockRejectedValueOnce(Object.assign(new Error('Not in this Event'), { statusCode: 404 }));

			await expect(screenWriteModule().createScreen({
				eventId: 1,
				input: {
					slug: 'main',
					modeConfigs: { card: {} },
				} as never,
				screenOutputAssetCapabilities: provideScreenOutputAssetCapabilities,
			})).rejects.toMatchObject({ statusCode: 404 });

			expect(mockValidateScreenModeConfigsReferences).toHaveBeenCalledWith(1, { card: {} });
			expect(mockScreenService.create).not.toHaveBeenCalled();
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
			// A slug refusal must not surface as a missing signing key instead.
			expect(provideScreenOutputAssetCapabilities).not.toHaveBeenCalled();
		});

		it('persists the prepared capability with the Screen and publishes it', async () => {
			const input = { slug: 'main' } as never;

			const response = await screenWriteModule().createScreen({
				eventId: 1,
				input,
				originConnectionId: 'origin-1',
				screenOutputAssetCapabilities: provideScreenOutputAssetCapabilities,
			});

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
				kind: 'asset',
				assetId: graphicAssetId('asset-1'),
				revisionId: graphicAssetRevisionId('revision-1'),
			};
			mockScreenService.findById.mockResolvedValue(createMockScreen({
				modeConfigs: { 'feature-match-overlay': config },
			}));

			await expect(screenWriteModule().updateScreen({
				authoringSessionId: undefined,
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
				kind: 'asset',
				assetId: graphicAssetId('asset-1'),
				revisionId: graphicAssetRevisionId('revision-1'),
			};
			mockScreenService.findById.mockResolvedValue(createMockScreen({
				modeConfigs: { 'feature-match-overlay': config },
			}));

			await screenWriteModule().updateScreen({
				authoringSessionId: undefined,
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
				authoringSessionId: undefined,
				eventId: 1,
				screenId: 404,
				input: { stateVersion: 0 } as never,
			})).rejects.toMatchObject({ statusCode: 404, message: 'Screen not found' });

			expect(mockScreenService.update).not.toHaveBeenCalled();
			expect(mockPublication.screenUpdated).not.toHaveBeenCalled();
		});

		it('writes the data versioned on the client\'s stateVersion and publishes the result', async () => {
			const response = await screenWriteModule().updateScreen({
				authoringSessionId: undefined,
				eventId: 1,
				screenId: 7,
				input: {
					stateVersion: 3,
					slug: 'renamed',
					modeConfigs: { card: {} },
				} as never,
				originConnectionId: 'origin-1',
			});

			expect(mockScreenService.slugExists).toHaveBeenCalledWith(1, 'renamed', 7);
			expect(mockScreenService.update.mock.calls[0]?.slice(0, 4)).toEqual([
				7,
				1,
				{
					slug: 'renamed',
					modeConfigs: { card: {} },
				},
				3,
			]);
			expect(mockPublication.screenUpdated).toHaveBeenCalledWith(expect.objectContaining({ eventId: 1, originConnectionId: 'origin-1' }));
			expect(response).toEqual({ id: 7, slug: 'main' });
		});

		it('rejects a duplicate slug with a 400', async () => {
			mockScreenService.slugExists.mockResolvedValue(true);

			await expect(screenWriteModule().updateScreen({
				authoringSessionId: undefined,
				eventId: 1,
				screenId: 7,
				input: { stateVersion: 0, slug: 'taken' } as never,
			})).rejects.toMatchObject({
				statusCode: 400,
				message: 'A screen with this slug already exists',
			});

			expect(mockScreenService.update).not.toHaveBeenCalled();
		});

		// Leaving the mode ends the epoch in the same commit; screenEpochEndAtomicity.sqlite proves that.
		it.each([
			[
				'a rename',
				{ name: 'Renamed' },
			],
			[
				'a write that restates the mode',
				{ currentMode: 'broadcast-graphics' },
			],
		])('leaves the Live Session running through %s while the Screen stays in Broadcast Graphics mode', async (_label, data) => {
			mockScreenService.findById.mockResolvedValue(createMockScreen({ id: 7, slug: 'main', currentMode: 'broadcast-graphics' }));
			mockScreenService.update.mockResolvedValue(createMockScreen({ id: 7, slug: 'main', currentMode: 'broadcast-graphics' }));

			await screenWriteModule().updateScreen({
				authoringSessionId: undefined,
				eventId: 1,
				screenId: 7,
				input: { stateVersion: 0, ...data } as never,
			});

			expect(mockBroadcastGraphicsLiveSessions.endEpochOnLeavingBroadcastGraphics).not.toHaveBeenCalled();
			expect(mockScreenService.update.mock.calls[0]?.[4]).toBeUndefined();
		});

		it('returns 404 when the versioned update finds nothing to write', async () => {
			mockScreenService.update.mockResolvedValue(undefined);

			await expect(screenWriteModule().updateScreen({
				authoringSessionId: undefined,
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

			// The cascade delete removes the sessions that identify their receipts.
			expect(mockBroadcastGraphicsLiveSessions.endSessionsForScreen.mock.invocationCallOrder[0]!)
				.toBeLessThan(mockScreenService.remove.mock.invocationCallOrder[0]!);
			expect(mockBroadcastGraphicsLiveSessions.endSessionsForScreen).toHaveBeenCalledWith(7, 1);
		});

		it('does not touch playout state when deleting a Screen that was never in Broadcast Graphics mode', async () => {
			mockScreenService.findById.mockResolvedValue(createMockScreen({ id: 7, slug: 'main', currentMode: 'background' }));

			await screenWriteModule().deleteScreen({ eventId: 1, screenId: 7 });

			expect(mockBroadcastGraphicsLiveSessions.endSessionsForScreen).not.toHaveBeenCalled();
			expect(mockScreenService.remove).toHaveBeenCalledWith(7, 1);
		});

		it('cleans up the derived card after the relational delete, then publishes', async () => {
			const result = await screenWriteModule().deleteScreen({ eventId: 1, screenId: 7, originConnectionId: 'origin-1' });

			// D1 is authoritative: derived Card state goes only once the delete committed.
			expect(mockScreenService.remove.mock.invocationCallOrder[0])
				.toBeLessThan(mockCardService.cleanupDeletedScreenCard.mock.invocationCallOrder[0]!);
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

		it('writes the config versioned on stateVersion and publishes the update', async () => {
			const response = await screenWriteModule().updateScreenConfig({
				eventId: 1,
				screenId: 7,
				config: { showLogo: false },
				stateVersion: 2,
				originConnectionId: 'origin-1',
			});

			expect(mockScreenService.updateScreenConfig.mock.calls[0]?.slice(0, 4)).toEqual([
				7,
				1,
				{ showLogo: false },
				2,
			]);
			expect(mockPublication.screenUpdated).toHaveBeenCalledWith(expect.objectContaining({ eventId: 1, originConnectionId: 'origin-1' }));
			expect(response).toEqual({ id: 7, slug: 'main' });
		});
	});

	describe('updateModeConfig', () => {
		it('checks newly selected Graphic Asset Revisions through the library before writing', async () => {
			const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
			config.layout.frame.backgroundImage = {
				kind: 'asset',
				assetId: graphicAssetId('asset-1'),
				revisionId: graphicAssetRevisionId('revision-1'),
			};
			const inspectGraphicAssetRevisions = vi.fn().mockResolvedValue([
				{
					outcome: 'available',
					lifecycleState: 'active',
					kind: 'image',
				},
			]);

			await screenWriteModule().updateModeConfig({
				authoringSessionId: undefined,
				eventId: 1,
				screenId: 7,
				mode: 'feature-match-overlay',
				config: { layout: config.layout },
				graphicsAssets: () => ({ inspectGraphicAssetRevisions }),
			});

			expect(inspectGraphicAssetRevisions).toHaveBeenCalledWith({
				references: [
					{
						assetId: graphicAssetId('asset-1'),
						revisionId: graphicAssetRevisionId('revision-1'),
					},
				],
			});
			expect(mockScreenService.updateModeConfig).toHaveBeenCalled();
		});

		it('rejects a newly selected unavailable Graphic Asset Revision before writing', async () => {
			const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
			config.layout.frame.backgroundImage = {
				kind: 'asset',
				assetId: graphicAssetId('asset-1'),
				revisionId: graphicAssetRevisionId('revision-1'),
			};

			await expect(screenWriteModule().updateModeConfig({
				authoringSessionId: undefined,
				eventId: 1,
				screenId: 7,
				mode: 'feature-match-overlay',
				config: { layout: config.layout },
				graphicsAssets: () => ({
					inspectGraphicAssetRevisions: vi.fn().mockResolvedValue([
						{
							outcome: 'unavailable',
							retryable: true,
						},
					]),
				}),
			})).rejects.toMatchObject({
				statusCode: 409,
				message: expect.stringContaining('layout.frame.backgroundImage'),
			});

			expect(mockScreenService.updateModeConfig).not.toHaveBeenCalled();
		});

		// One question per reference was one remote round-trip each (#374), so the
		// library is asked once, in discovery order, and the first bad slot is named.
		it('asks the library once for every changed reference and refuses with the first unselectable slot', async () => {
			const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
			config.layout.frame.backgroundImage = {
				kind: 'asset',
				assetId: graphicAssetId('asset-1'),
				revisionId: graphicAssetRevisionId('revision-1'),
			};
			const [topBar] = config.layout.composition.items;
			if (topBar?.type !== 'group')
				throw new Error('Fixture expects the default layout to lead with the Top Player Bar group');
			const [nameRecord] = topBar.children;
			if (nameRecord?.type !== 'text')
				throw new Error('Fixture expects the Top Player Bar to lead with a Text Graphic Item');
			nameRecord.typography.font = {
				kind: 'asset',
				reference: {
					assetId: graphicAssetId('asset-2'),
					revisionId: graphicAssetRevisionId('revision-1'),
				},
			};
			const inspectGraphicAssetRevisions = vi.fn().mockResolvedValue([
				{ outcome: 'available', lifecycleState: 'active', kind: 'image' },
				{ outcome: 'missing' },
			]);

			await expect(screenWriteModule().updateModeConfig({
				authoringSessionId: undefined,
				eventId: 1,
				screenId: 7,
				mode: 'feature-match-overlay',
				config: { layout: config.layout },
				graphicsAssets: () => ({ inspectGraphicAssetRevisions }),
			})).rejects.toMatchObject({
				statusCode: 409,
				message: expect.stringContaining('typography.font'),
			});

			expect(inspectGraphicAssetRevisions).toHaveBeenCalledTimes(1);
			expect(inspectGraphicAssetRevisions).toHaveBeenCalledWith({
				references: [
					{
						assetId: graphicAssetId('asset-1'),
						revisionId: graphicAssetRevisionId('revision-1'),
					},
					{
						assetId: graphicAssetId('asset-2'),
						revisionId: graphicAssetRevisionId('revision-1'),
					},
				],
			});
			expect(mockScreenService.updateModeConfig).not.toHaveBeenCalled();

			// Both fail: the refusal still names the first slot.
			inspectGraphicAssetRevisions.mockResolvedValue([
				{ outcome: 'missing' },
				{ outcome: 'missing' },
			]);
			await expect(screenWriteModule().updateModeConfig({
				authoringSessionId: undefined,
				eventId: 1,
				screenId: 7,
				mode: 'feature-match-overlay',
				config: { layout: config.layout },
				graphicsAssets: () => ({ inspectGraphicAssetRevisions }),
			})).rejects.toMatchObject({
				statusCode: 409,
				message: expect.stringContaining('layout.frame.backgroundImage'),
			});

			// A short answer from the library refuses rather than admits.
			inspectGraphicAssetRevisions.mockResolvedValue([
				{ outcome: 'available', lifecycleState: 'active', kind: 'image' },
			]);
			await expect(screenWriteModule().updateModeConfig({
				authoringSessionId: undefined,
				eventId: 1,
				screenId: 7,
				mode: 'feature-match-overlay',
				config: { layout: config.layout },
				graphicsAssets: () => ({ inspectGraphicAssetRevisions }),
			})).rejects.toMatchObject({
				statusCode: 409,
				message: expect.stringContaining('typography.font'),
			});
			expect(mockScreenService.updateModeConfig).not.toHaveBeenCalled();
		});

		// The library is built only by a write that changes a reference (#247).
		it('does not build the Graphics Asset Library for a Screen Mode that pins no references', async () => {
			await screenWriteModule().updateModeConfig({
				authoringSessionId: undefined,
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
				kind: 'asset',
				assetId: graphicAssetId('asset-1'),
				revisionId: graphicAssetRevisionId('revision-1'),
			};
			mockScreenService.findById.mockResolvedValue(createMockScreen({
				id: 7,
				modeConfigs: { 'feature-match-overlay': config },
			}));

			await screenWriteModule().updateModeConfig({
				authoringSessionId: undefined,
				eventId: 1,
				screenId: 7,
				mode: 'feature-match-overlay',
				config: { layout: config.layout },
				graphicsAssets: provideGraphicsAssets,
			});

			// An unchanged pinned revision is never re-checked; it outlives its asset's retirement.
			expect(mockScreenService.updateModeConfig).toHaveBeenCalled();
			expect(provideGraphicsAssets).not.toHaveBeenCalled();
			expect(mockGraphicsAssets.inspectGraphicAssetRevisions).not.toHaveBeenCalled();

			// Control: moving the revision does build the library and ask.
			mockGraphicsAssets.inspectGraphicAssetRevisions.mockResolvedValue([
				{
					outcome: 'available',
					lifecycleState: 'active',
					kind: 'image',
				},
			]);
			const moved = structuredClone(config);
			moved.layout.frame.backgroundImage = {
				kind: 'asset',
				assetId: graphicAssetId('asset-1'),
				revisionId: graphicAssetRevisionId('revision-2'),
			};

			await screenWriteModule().updateModeConfig({
				authoringSessionId: undefined,
				eventId: 1,
				screenId: 7,
				mode: 'feature-match-overlay',
				config: { layout: moved.layout },
				graphicsAssets: provideGraphicsAssets,
			});

			expect(provideGraphicsAssets).toHaveBeenCalledTimes(1);
			expect(mockGraphicsAssets.inspectGraphicAssetRevisions).toHaveBeenCalledWith({
				references: [
					{
						assetId: 'asset-1',
						revisionId: 'revision-2',
					},
				],
			});
		});

		it('refuses a mode config naming a reference outside the Event before writing', async () => {
			mockValidateScreenModeConfigReferences.mockRejectedValueOnce(Object.assign(new Error('Not in this Event'), { statusCode: 404 }));

			await expect(screenWriteModule().updateModeConfig({
				authoringSessionId: undefined,
				eventId: 1,
				screenId: 7,
				mode: 'card',
				config: { featureMatchId: 5 },
				graphicsAssets: provideGraphicsAssets,
			})).rejects.toMatchObject({ statusCode: 404 });

			expect(mockValidateScreenModeConfigReferences).toHaveBeenCalledWith(1, 'card', { featureMatchId: 5 });
			expect(mockScreenService.updateModeConfig).not.toHaveBeenCalled();
		});

		it('returns 404 when the screen does not exist', async () => {
			mockScreenService.updateModeConfig.mockResolvedValue(undefined);

			await expect(screenWriteModule().updateModeConfig({
				authoringSessionId: undefined,
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
				authoringSessionId: undefined,
				eventId: 1,
				screenId: 7,
				mode: 'card',
				config: {},
				originConnectionId: 'origin-1',
				graphicsAssets: provideGraphicsAssets,
			});

			expect(mockPublication.screenUpdated).toHaveBeenCalledWith(expect.objectContaining({ eventId: 1, originConnectionId: 'origin-1' }));
			expect(response).toEqual({ id: 7, slug: 'main' });
		});
	});
});
