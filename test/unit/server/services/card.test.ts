import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockKv = {
	get: vi.fn(),
	set: vi.fn(),
	del: vi.fn(),
};

const mockFindFirst = vi.fn();
const mockReturning = vi.fn();
const mockWhere = vi.fn(() => ({ returning: mockReturning }));
const mockSet = vi.fn(() => ({ where: mockWhere }));
const mockUpdate = vi.fn(() => ({ set: mockSet }));

// Nitro's auto-imported storage. Only the `kv` mount (the KV binding) answers
// with `mockKv`, so a card written through any other mount misses every
// assertion on its key.
vi.stubGlobal('useStorage', vi.fn((base?: string) => base === 'kv'
	? mockKv
	: {
			get: vi.fn(),
			set: vi.fn(),
			del: vi.fn(),
		}));
vi.mock('~~/server/db', () => ({
	db: {
		update: mockUpdate,
		query: {
			screens: { findFirst: mockFindFirst },
		},
	},
}));
vi.mock('drizzle-orm', () => ({
	and: (...conditions: unknown[]) => ({ and: conditions }),
	eq: (field: unknown, value: unknown) => ({ field, value }),
	sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
		strings: [...strings],
		values,
	}),
}));
vi.mock('~~/server/db/schema', () => ({
	screens: {
		id: 'screens.id',
		eventId: 'screens.eventId',
		activeCardVersion: 'screens.activeCardVersion',
	},
}));
vi.mock('~~/server/schemas/kv/card', () => ({
	storedCardSchema: {
		parse: (data: any) => data,
		safeParse: (data: any) => ({ success: true, data }),
	},
}));

const { cardService } = await import('~~/server/services/card');

describe('cardService', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockKv.get.mockReset();
		mockKv.set.mockReset();
		mockKv.del.mockReset();
		mockReturning.mockResolvedValue([
			{ revision: 4 },
		]);
		mockFindFirst.mockResolvedValue({ activeCard: null, activeCardVersion: 0 });
	});

	describe('setScreenCard', () => {
		it('stores card data in KV', async () => {
			const cardData = {
				id: 'card-1',
				name: 'Lightning Bolt',
				set: 'alpha',
				layout: 'normal',
				imageData: { front: null, back: null },
				orientationData: {
					flipable: false,
					turnable: false,
					rotateable: false,
					counterRotateable: false,
				},
				displayData: {
					flipped: false,
					rotated: false,
					counterRotated: false,
					turnedOver: false,
				},
			};

			// The save answers the Card revision it committed (#734).
			await expect(cardService().setScreenCard(1, 2, cardData as any)).resolves.toBe(4);

			expect(mockKv.set).toHaveBeenCalledWith(
				'event:1:screen:2:card',
				expect.objectContaining({
					id: 'card-1',
					savedAt: expect.any(Number),
				}),
			);
			expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
				activeCard: expect.objectContaining({ id: 'card-1' }),
				activeCardVersion: expect.any(Object),
				updatedAt: expect.any(Date),
			}));
		});

		it('keeps the committed D1 state when the derived KV cache is unavailable', async () => {
			mockKv.set.mockRejectedValue(new Error('KV unavailable'));
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
			const cardData = {
				id: 'card-1',
				name: 'Lightning Bolt',
				set: 'alpha',
				layout: 'normal',
				imageData: { front: null, back: null },
				orientationData: {
					flipable: false,
					turnable: false,
					rotateable: false,
					counterRotateable: false,
				},
				displayData: {
					flipped: false,
					rotated: false,
					counterRotated: false,
					turnedOver: false,
				},
			};

			await expect(cardService().setScreenCard(1, 2, cardData as any)).resolves.toBe(4);
			expect(mockReturning).toHaveBeenCalled();
			expect(warn).toHaveBeenCalledWith(expect.stringContaining('kv_set'));
			warn.mockRestore();
		});

		it('does not write the cache when the authoritative Screen is missing', async () => {
			mockReturning.mockResolvedValue([]);

			await expect(cardService().setScreenCard(1, 2, {
				id: 'card-1',
				name: 'Lightning Bolt',
				set: 'alpha',
				layout: 'normal',
				imageData: { front: null, back: null },
				orientationData: {
					flipable: false,
					turnable: false,
					rotateable: false,
					counterRotateable: false,
				},
				displayData: {
					flipped: false,
					rotated: false,
					counterRotated: false,
					turnedOver: false,
				},
			} as any)).rejects.toThrow('Screen not found');
			expect(mockKv.set).not.toHaveBeenCalled();
		});
	});

	describe('getScreenCard', () => {
		it('returns the stored Card with the revision it was read at', async () => {
			const stored = { id: 'card-1', name: 'Bolt', savedAt: 123 };
			mockFindFirst.mockResolvedValue({ activeCard: stored, activeCardVersion: 3 });

			const result = await cardService().getScreenCard(1, 2);

			expect(result).toEqual({ card: stored, revision: 3 });
			expect(mockFindFirst).toHaveBeenCalled();
			expect(mockKv.get).not.toHaveBeenCalled();
		});

		it('does not return a persisted card after its timeout has expired', async () => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date('2026-07-16T00:00:00.000Z'));
			mockFindFirst.mockResolvedValue({
				activeCardVersion: 3,
				activeCard: {
					id: 'card-1',
					name: 'Bolt',
					savedAt: 123,
					timeoutData: {
						timeoutStartTimestamp: Date.now() - 10_000,
						timeoutDuration: 5_000,
					},
				},
			});

			// Expiry is a projection (ADR-0022): the read answers no Card and writes nothing.
			await expect(cardService().getScreenCard(1, 2)).resolves.toEqual({ card: null, revision: 3 });
			expect(mockUpdate).not.toHaveBeenCalled();
			expect(mockKv.del).not.toHaveBeenCalled();
			vi.useRealTimers();
		});
	});

	describe('deleteScreenCard', () => {
		it('deletes card data from KV', async () => {
			await expect(cardService().deleteScreenCard(1, 2)).resolves.toBe(4);

			expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ activeCard: null }));
			expect(mockKv.del).toHaveBeenCalledWith('event:1:screen:2:card');
		});
	});
});
