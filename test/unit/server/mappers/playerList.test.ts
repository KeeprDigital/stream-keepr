import { describe, expect, it } from 'vitest';
import { mapPlayerListToResponse, mapPlayerListToSummaryResponse } from '~~/server/mappers/playerList';
import { createMockPlayerList } from '~~/test/helpers/fixtures';

describe('playerList mapper', () => {
	describe('mapPlayerListToSummaryResponse', () => {
		it('includes memberCount in the response', () => {
			const list = { ...createMockPlayerList(), memberCount: 8 };
			const result = mapPlayerListToSummaryResponse(list);

			expect(result.memberCount).toBe(8);
		});

		it('includes memberCount of zero', () => {
			const list = { ...createMockPlayerList(), memberCount: 0 };
			const result = mapPlayerListToSummaryResponse(list);

			expect(result.memberCount).toBe(0);
		});

		it('converts createdAt and updatedAt to Date instances', () => {
			const list = {
				...createMockPlayerList({
					createdAt: '2026-05-01T00:00:00.000Z' as unknown as Date,
					updatedAt: '2026-05-02T00:00:00.000Z' as unknown as Date,
				}),
				memberCount: 3,
			};
			const result = mapPlayerListToSummaryResponse(list);

			expect(result.createdAt).toBeInstanceOf(Date);
			expect(result.updatedAt).toBeInstanceOf(Date);
			expect(result.createdAt).toEqual(new Date('2026-05-01T00:00:00.000Z'));
			expect(result.updatedAt).toEqual(new Date('2026-05-02T00:00:00.000Z'));
		});

		it('preserves all list fields in the response', () => {
			const list = {
				...createMockPlayerList({ id: 10, eventId: 5, name: 'Top 8' }),
				memberCount: 8,
			};
			const result = mapPlayerListToSummaryResponse(list);

			expect(result.id).toBe(10);
			expect(result.eventId).toBe(5);
			expect(result.name).toBe('Top 8');
			expect(result.memberCount).toBe(8);
		});
	});

	describe('mapPlayerListToResponse', () => {
		it('converts createdAt and updatedAt to Date instances', () => {
			const list = createMockPlayerList({
				createdAt: '2026-07-01T10:00:00.000Z' as unknown as Date,
				updatedAt: '2026-07-01T11:00:00.000Z' as unknown as Date,
			});
			const result = mapPlayerListToResponse(list);

			expect(result.createdAt).toBeInstanceOf(Date);
			expect(result.updatedAt).toBeInstanceOf(Date);
			expect(result.createdAt).toEqual(new Date('2026-07-01T10:00:00.000Z'));
			expect(result.updatedAt).toEqual(new Date('2026-07-01T11:00:00.000Z'));
		});

		it('preserves Date objects that are already Date instances', () => {
			const created = new Date('2026-01-01T00:00:00.000Z');
			const updated = new Date('2026-01-02T00:00:00.000Z');
			const list = createMockPlayerList({ createdAt: created, updatedAt: updated });
			const result = mapPlayerListToResponse(list);

			expect(result.createdAt).toBeInstanceOf(Date);
			expect(result.updatedAt).toBeInstanceOf(Date);
			expect(result.createdAt).toEqual(created);
			expect(result.updatedAt).toEqual(updated);
		});

		it('preserves all list fields in the response', () => {
			const list = createMockPlayerList({ id: 20, eventId: 7, name: 'Feature Match Pool' });
			const result = mapPlayerListToResponse(list);

			expect(result.id).toBe(20);
			expect(result.eventId).toBe(7);
			expect(result.name).toBe('Feature Match Pool');
		});
	});
});
