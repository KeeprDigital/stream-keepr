import { describe, expect, it } from 'vitest';
import { mapRoundToResponse } from '~~/server/mappers/round';
import { createMockRound } from '~~/test/helpers/fixtures';

describe('round mapper', () => {
	describe('mapRoundToResponse', () => {
		it('converts createdAt and updatedAt to Date instances', () => {
			const round = createMockRound({
				createdAt: '2026-01-15T12:00:00.000Z' as unknown as Date,
				updatedAt: '2026-02-20T18:30:00.000Z' as unknown as Date,
			});
			const result = mapRoundToResponse(round);

			expect(result.createdAt).toBeInstanceOf(Date);
			expect(result.updatedAt).toBeInstanceOf(Date);
			expect(result.createdAt).toEqual(new Date('2026-01-15T12:00:00.000Z'));
			expect(result.updatedAt).toEqual(new Date('2026-02-20T18:30:00.000Z'));
		});

		it('preserves Date objects that are already Date instances', () => {
			const created = new Date('2026-03-01T00:00:00.000Z');
			const updated = new Date('2026-03-02T00:00:00.000Z');
			const round = createMockRound({ createdAt: created, updatedAt: updated });
			const result = mapRoundToResponse(round);

			expect(result.createdAt).toBeInstanceOf(Date);
			expect(result.updatedAt).toBeInstanceOf(Date);
			expect(result.createdAt).toEqual(created);
			expect(result.updatedAt).toEqual(updated);
		});

		it('passes through all fields', () => {
			const round = createMockRound({
				id: 42,
				eventId: 7,
				roundNumber: 3,
				name: 'Quarterfinals',
				phaseName: 'Top 8',
			});
			const result = mapRoundToResponse(round);

			expect(result.id).toBe(42);
			expect(result.eventId).toBe(7);
			expect(result.roundNumber).toBe(3);
			expect(result.name).toBe('Quarterfinals');
			expect(result.phaseName).toBe('Top 8');
		});
	});
});
