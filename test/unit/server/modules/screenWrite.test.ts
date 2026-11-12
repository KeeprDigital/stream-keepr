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

// A Feature Match Layout write is lease-admitted (#738); the lease itself is proved
// against the real table in `screenGraphicsAuthoringLease.sqlite.test.ts`.
vi.mock('~~/server/modules/graphics-authoring-lease/screenEditWorkspace', () => ({
	admitScreenGraphicsEditWrite: async (eventId: number, screenId: number, sessionId: string | undefined) => ({
		artifact: {
			kind: 'screen-edit-workspace',
			id: String(screenId),
		},
		eventId,
		sessionId,
	}),
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
	});
});
