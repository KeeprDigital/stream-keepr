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

const mockPublishMessage = vi.fn();

// Nitro's auto-imported storage. Only the `kv` mount (the KV binding) answers
// with `mockKv`, so a card written through any other mount misses every
// assertion on its key.
vi.stubGlobal('useStorage', vi.fn((base?: string) => base === 'kv'
	? mockKv
	: { get: vi.fn(), set: vi.fn(), del: vi.fn() }));
vi.mock('~~/server/db', () => ({
	db: {
		update: mockUpdate,
		query: { screens: { findFirst: mockFindFirst } },
	},
}));
vi.mock('drizzle-orm', () => ({
	and: (...conditions: unknown[]) => ({ and: conditions }),
	eq: (field: unknown, value: unknown) => ({ field, value }),
	sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings: [...strings], values }),
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
// publishMessage is auto-imported in Nitro context
vi.stubGlobal('publishMessage', mockPublishMessage);

const { cardService } = await import('~~/server/services/card');

describe('cardService', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockKv.get.mockReset();
		mockKv.set.mockReset();
		mockKv.del.mockReset();
		mockReturning.mockResolvedValue([{ id: 2 }]);
		mockFindFirst.mockResolvedValue({ activeCard: null });
	});

	describe('setScreenCard', () => {
		it('stores card data in KV', async () => {
			const cardData = {
				id: 'card-1',
				name: 'Lightning Bolt',
				set: 'alpha',
				layout: 'normal',
				imageData: { front: null, back: null },
				orientationData: { flipable: false, turnable: false, rotateable: false, counterRotateable: false },
				displayData: { flipped: false, rotated: false, counterRotated: false, turnedOver: false },
			};

			await cardService().setScreenCard(1, 2, cardData as any);

			expect(mockKv.set).toHaveBeenCalledWith(
				'event:1:screen:2:card',
				expect.objectContaining({ id: 'card-1', savedAt: expect.any(Number) }),
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
				orientationData: { flipable: false, turnable: false, rotateable: false, counterRotateable: false },
				displayData: { flipped: false, rotated: false, counterRotated: false, turnedOver: false },
			};

			await expect(cardService().setScreenCard(1, 2, cardData as any)).resolves.toBeUndefined();
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
				orientationData: { flipable: false, turnable: false, rotateable: false, counterRotateable: false },
				displayData: { flipped: false, rotated: false, counterRotated: false, turnedOver: false },
			} as any)).rejects.toThrow('Screen not found');
			expect(mockKv.set).not.toHaveBeenCalled();
		});

		it('publishes a card:timeout message when timeoutData has remaining time', async () => {
			const now = Date.now();
			const cardData = {
				id: 'card-1',
				name: 'Lightning Bolt',
				set: 'alpha',
				layout: 'normal',
				imageData: { front: null, back: null },
				orientationData: { flipable: false, turnable: false, rotateable: false, counterRotateable: false },
				displayData: { flipped: false, rotated: false, counterRotated: false, turnedOver: false },
				timeoutData: {
					timeoutDuration: 60_000,
					timeoutStartTimestamp: now, // just started — plenty of time remaining
				},
			};

			await cardService().setScreenCard(1, 2, cardData as any, 'conn-1');

			// publishMessage is called for card:timeout
			expect(mockPublishMessage).toHaveBeenCalledWith(
				1,
				'card:timeout',
				expect.objectContaining({ timeoutDuration: expect.any(Number), screenId: 2 }),
				'conn-1',
			);
		});
	});

	describe('getScreenCard', () => {
		it('returns parsed card data from KV', async () => {
			const stored = { id: 'card-1', name: 'Bolt', savedAt: 123 };
			mockFindFirst.mockResolvedValue({ activeCard: stored });

			const result = await cardService().getScreenCard(1, 2);

			expect(result).toEqual(stored);
			expect(mockFindFirst).toHaveBeenCalled();
			expect(mockKv.get).not.toHaveBeenCalled();
		});

		it('does not return a persisted card after its timeout has expired', async () => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date('2026-07-16T00:00:00.000Z'));
			mockFindFirst.mockResolvedValue({
				activeCardVersion: 7,
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

			await expect(cardService().getScreenCard(1, 2)).resolves.toBeNull();
			expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ activeCard: null }));
			expect(mockKv.del).toHaveBeenCalledWith('event:1:screen:2:card');
			vi.useRealTimers();
		});
	});

	describe('deleteScreenCard', () => {
		it('deletes card data from KV', async () => {
			await cardService().deleteScreenCard(1, 2);

			expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ activeCard: null }));
			expect(mockKv.del).toHaveBeenCalledWith('event:1:screen:2:card');
		});
	});
});
