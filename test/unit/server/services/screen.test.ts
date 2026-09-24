import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';
import { getChain, mockD1Client, mockDb, resetDbMocks } from '~~/test/helpers/db-mock';
import { createMockScreen } from '~~/test/helpers/fixtures';
import { testGraphicAssetId, testGraphicAssetRevisionId } from '~~/test/helpers/graphicsAssetIdentities';

vi.mock('~~/server/db', () => ({ db: mockDb }));
vi.mock('~~/server/db/schema', () => ({
	screens: {
		id: 'screens.id',
		eventId: 'screens.eventId',
		slug: 'screens.slug',
		name: 'screens.name',
		stateVersion: 'screens.stateVersion',
		assetCapabilityVersion: 'screens.assetCapabilityVersion',
	},
}));

const { screenService } = await import('~~/server/services/screen');

describe('screenService', () => {
	beforeEach(() => {
		resetDbMocks();
	});

	describe('findById', () => {
		it('returns screen when found', async () => {
			const screen = createMockScreen();
			mockDb.query.screens.findFirst.mockResolvedValue(screen);

			const result = await screenService().findById(1, 1);

			expect(result).toEqual(screen);
		});
	});

	describe('findBySlug', () => {
		it('returns screen when slug matches', async () => {
			const screen = createMockScreen({ slug: 'main' });
			mockDb.query.screens.findFirst.mockResolvedValue(screen);

			const result = await screenService().findBySlug(1, 'main');

			expect(result).toEqual(screen);
		});
	});

	describe('findByEventId', () => {
		it('returns all screens for event', async () => {
			const screens = [createMockScreen(), createMockScreen({ id: 2 })];
			getChain('select').orderBy.mockResolvedValue(screens);

			const result = await screenService().findByEventId(1);

			expect(result).toEqual(screens);
		});

		it('returns empty array when no screens', async () => {
			getChain('select').orderBy.mockResolvedValue([]);

			const result = await screenService().findByEventId(1);

			expect(result).toEqual([]);
		});
	});

	describe('findIdsByEventId', () => {
		it('projects only Screen identities for bounded cleanup work', async () => {
			getChain('select').where.mockResolvedValue([{ id: 1 }, { id: 2 }]);

			const result = await screenService().findIdsByEventId(1);

			expect(mockDb.select).toHaveBeenCalledWith({ id: 'screens.id' });
			expect(result).toEqual([{ id: 1 }, { id: 2 }]);
		});
	});

	describe('create', () => {
		it('stores capability authorization material atomically with the created Screen', async () => {
			const newScreen = createMockScreen({ name: 'New Screen' });
			getChain('insert').returning.mockResolvedValue([newScreen]);
			const capability = {
				assetCapabilitySeed: 'seed-1',
				assetCapabilityVersion: 1,
				assetCapabilityDigest: 'digest-1',
			};

			const result = await screenService().create(
				1,
				{ name: 'New Screen', slug: 'new-screen' } as any,
				capability,
			);

			expect(result).toEqual(newScreen);
			expect(getChain('insert').values).toHaveBeenCalledWith({
				name: 'New Screen',
				slug: 'new-screen',
				eventId: 1,
				...capability,
			});
		});
	});

	describe('replaceAssetCapability', () => {
		it('rotates only the expected current capability version', async () => {
			const rotated = createMockScreen({
				assetCapabilitySeed: 'seed-2',
				assetCapabilityVersion: 2,
				assetCapabilityDigest: 'digest-2',
			});
			getChain('update').returning.mockResolvedValue([rotated]);

			const result = await screenService().replaceAssetCapability(
				1,
				1,
				{
					assetCapabilitySeed: 'seed-2',
					assetCapabilityVersion: 2,
					assetCapabilityDigest: 'digest-2',
				},
				1,
			);

			expect(result).toEqual(rotated);
			expect(getChain('update').set).toHaveBeenCalledWith({
				assetCapabilitySeed: 'seed-2',
				assetCapabilityVersion: 2,
				assetCapabilityDigest: 'digest-2',
			});
		});
	});

	describe('update', () => {
		it('returns updated screen via versioned write', async () => {
			const updated = createMockScreen({ name: 'Updated', stateVersion: 1 });
			mockDb.batch.mockResolvedValue([[updated]]);

			const result = await screenService().update(1, 1, { name: 'Updated' } as any, 0);

			expect(result).toEqual(updated);
		});

		it('commits the statements a caller sends with the write, after it', async () => {
			// A consequence that must not be separable from the write — leaving
			// Broadcast Graphics mode ends the Screen's playout epoch — rides in the
			// same batch, behind the update whose postcondition it is guarded on.
			const updated = createMockScreen({ name: 'Updated', stateVersion: 1 });
			mockDb.batch.mockResolvedValue([[updated]]);

			await screenService().update(1, 1, { name: 'Updated' } as any, 0, [
				'end-epoch' as never,
				'clear-references' as never,
			]);

			const committed = mockDb.batch.mock.calls[0]?.[0] as unknown[];
			expect(committed).toHaveLength(3);
			expect(committed.slice(1)).toEqual(['end-epoch', 'clear-references']);
		});
	});

	describe('remove', () => {
		it('returns true when deleted', async () => {
			mockD1Client.batch.mockResolvedValue([
				{ meta: { changes: 1 } },
				{ meta: { changes: 2 } },
				{ meta: { changes: 1 } },
			]);

			const result = await screenService().remove(1, 1);

			expect(result).toBe(true);
		});

		it('returns false when not found', async () => {
			mockD1Client.batch.mockResolvedValue([
				{ meta: { changes: 0 } },
				{ meta: { changes: 0 } },
				{ meta: { changes: 0 } },
			]);

			const result = await screenService().remove(999, 1);

			expect(result).toBe(false);
		});
	});

	describe('updateModeConfig', () => {
		it('guards the Screen update with every exact Graphic Asset Reference precondition', async () => {
			const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
			config.layout.frame.backgroundImage = {
				assetId: testGraphicAssetId('asset-1'),
				revisionId: testGraphicAssetRevisionId('revision-1'),
			};
			const screen = createMockScreen({
				currentMode: 'feature-match-overlay',
				modeConfigs: { 'feature-match-overlay': DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG },
			});
			const updatedScreen = createMockScreen({
				currentMode: 'feature-match-overlay',
				modeConfigs: { 'feature-match-overlay': config },
				stateVersion: 1,
			});
			mockDb.query.screens.findFirst
				.mockResolvedValueOnce(screen)
				.mockResolvedValueOnce(updatedScreen);
			mockD1Client.batch.mockResolvedValue([
				{ meta: { changes: 1 } },
				{ meta: { changes: 0 } },
				{ meta: { changes: 1 } },
			]);

			const result = await screenService().updateModeConfig(
				1,
				1,
				'feature-match-overlay',
				{ layout: config.layout },
			);

			const updateSql = mockD1Client.prepare.mock.calls[0]?.[0] as string;
			expect(updateSql).toContain('FROM graphic_asset_revisions revision');
			expect(updateSql).toContain('asset.lifecycle_state = \'active\'');
			expect(result).toEqual(updatedScreen);
		});

		it('merges config for given mode', async () => {
			const screen = createMockScreen({ modeConfigs: { card: { text: 'Hello' } } as any });
			mockDb.query.screens.findFirst.mockResolvedValue(screen);
			const updatedScreen = createMockScreen({ stateVersion: 1 });
			mockDb.batch.mockResolvedValue([[updatedScreen]]);

			const result = await screenService().updateModeConfig(1, 1, 'card' as any, { text: 'World' });

			expect(result).toEqual(updatedScreen);
		});
	});

	describe('updateScreenConfig', () => {
		it('merges screen-level config', async () => {
			const screen = createMockScreen({ screenConfig: { theme: 'dark' } as any });
			mockDb.query.screens.findFirst.mockResolvedValue(screen);
			const updatedScreen = createMockScreen({ stateVersion: 1 });
			mockDb.batch.mockResolvedValue([[updatedScreen]]);

			const result = await screenService().updateScreenConfig(1, 1, { theme: 'light' });

			expect(result).toEqual(updatedScreen);
		});
	});

	describe('slugExists', () => {
		it('returns true when slug exists', async () => {
			mockDb.query.screens.findFirst.mockResolvedValue({ id: 1 });

			const result = await screenService().slugExists(1, 'taken');

			expect(result).toBe(true);
		});

		it('returns false when slug available', async () => {
			mockDb.query.screens.findFirst.mockResolvedValue(undefined);

			const result = await screenService().slugExists(1, 'available');

			expect(result).toBe(false);
		});
	});
});
