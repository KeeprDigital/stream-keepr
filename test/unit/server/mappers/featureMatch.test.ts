import { describe, expect, it } from 'vitest';
import { mapFeatureMatchToResponse } from '~~/server/mappers/featureMatch';
import { createMockFeatureMatch } from '~~/test/helpers/fixtures';

describe('feature match mapper', () => {
	describe('mapFeatureMatchToResponse', () => {
		it('converts createdAt and updatedAt to Date instances', () => {
			const match = createMockFeatureMatch({
				createdAt: '2026-03-10T08:00:00.000Z' as unknown as Date,
				updatedAt: '2026-03-10T09:30:00.000Z' as unknown as Date,
			});
			const result = mapFeatureMatchToResponse(match);

			expect(result.createdAt).toBeInstanceOf(Date);
			expect(result.updatedAt).toBeInstanceOf(Date);
			expect(result.createdAt).toEqual(new Date('2026-03-10T08:00:00.000Z'));
			expect(result.updatedAt).toEqual(new Date('2026-03-10T09:30:00.000Z'));
		});

		it('preserves Date objects that are already Date instances', () => {
			const created = new Date('2026-01-01T00:00:00.000Z');
			const updated = new Date('2026-01-02T00:00:00.000Z');
			const match = createMockFeatureMatch({ createdAt: created, updatedAt: updated });
			const result = mapFeatureMatchToResponse(match);

			expect(result.createdAt).toBeInstanceOf(Date);
			expect(result.updatedAt).toBeInstanceOf(Date);
			expect(result.createdAt).toEqual(created);
			expect(result.updatedAt).toEqual(updated);
		});

		it('preserves all match fields in the response', () => {
			const match = createMockFeatureMatch({
				id: 7,
				eventId: 3,
				bestOf: 5,
				sortOrder: 2,
				tableNumber: 10,
				player1Id: 100,
				player2Id: 200,
				playerDisplayMode: 'score',
			});
			const result = mapFeatureMatchToResponse(match);

			expect(result.id).toBe(7);
			expect(result.eventId).toBe(3);
			expect(result.bestOf).toBe(5);
			expect(result.sortOrder).toBe(2);
			expect(result.tableNumber).toBe(10);
			expect(result.player1Id).toBe(100);
			expect(result.player2Id).toBe(200);
			expect(result.playerDisplayMode).toBe('score');
		});

		it('preserves null optional fields', () => {
			const match = createMockFeatureMatch({
				player1Id: null,
				player2Id: null,
				externalId: null,
				tableNumber: null,
			});
			const result = mapFeatureMatchToResponse(match);

			expect(result.player1Id).toBeNull();
			expect(result.player2Id).toBeNull();
			expect(result.externalId).toBeNull();
			expect(result.tableNumber).toBeNull();
		});
	});
});
