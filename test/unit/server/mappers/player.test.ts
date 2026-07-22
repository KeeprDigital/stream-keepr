import { describe, expect, it } from 'vitest';
import { mapPlayerToResponse } from '~~/server/mappers/player';
import { createMockPlayer } from '~~/test/helpers/fixtures';

describe('player mapper', () => {
	describe('mapPlayerToResponse', () => {
		it('converts createdAt and updatedAt to Date instances', () => {
			const player = createMockPlayer({
				createdAt: '2026-04-15T12:00:00.000Z' as unknown as Date,
				updatedAt: '2026-04-15T13:00:00.000Z' as unknown as Date,
			});
			const result = mapPlayerToResponse(player);

			expect(result.createdAt).toBeInstanceOf(Date);
			expect(result.updatedAt).toBeInstanceOf(Date);
			expect(result.createdAt).toEqual(new Date('2026-04-15T12:00:00.000Z'));
			expect(result.updatedAt).toEqual(new Date('2026-04-15T13:00:00.000Z'));
		});

		it('preserves Date objects that are already Date instances', () => {
			const created = new Date('2026-01-01T00:00:00.000Z');
			const updated = new Date('2026-01-02T00:00:00.000Z');
			const player = createMockPlayer({ createdAt: created, updatedAt: updated });
			const result = mapPlayerToResponse(player);

			expect(result.createdAt).toBeInstanceOf(Date);
			expect(result.updatedAt).toBeInstanceOf(Date);
			expect(result.createdAt).toEqual(created);
			expect(result.updatedAt).toEqual(updated);
		});

		it('preserves all player fields in the response', () => {
			const player = createMockPlayer({
				id: 42,
				eventId: 3,
				name: 'Reid Duke',
				pronouns: 'he/him',
				wins: 5,
				losses: 2,
				draws: 1,
				position: 3,
				points: 16,
			});
			const result = mapPlayerToResponse(player);

			expect(result.id).toBe(42);
			expect(result.eventId).toBe(3);
			expect(result.name).toBe('Reid Duke');
			expect(result.pronouns).toBe('he/him');
			expect(result.wins).toBe(5);
			expect(result.losses).toBe(2);
			expect(result.draws).toBe(1);
			expect(result.position).toBe(3);
			expect(result.points).toBe(16);
		});

		it('keeps Melee lifecycle bookkeeping internal', () => {
			const result = mapPlayerToResponse(createMockPlayer({
				externalStatus: 7,
				isActive: false,
				lastSeenAt: new Date('2026-04-15T12:00:00.000Z'),
			}));

			expect(result).not.toHaveProperty('externalStatus');
			expect(result).not.toHaveProperty('isActive');
			expect(result).not.toHaveProperty('lastSeenAt');
		});

		it('preserves null optional fields', () => {
			const player = createMockPlayer({
				pronouns: null,
				externalId: null,
				wins: null,
				losses: null,
				draws: null,
				position: null,
				points: null,
				deckList: null,
				lgs: null,
				gameData: null,
			});
			const result = mapPlayerToResponse(player);

			expect(result.pronouns).toBeNull();
			expect(result.externalId).toBeNull();
			expect(result.wins).toBeNull();
			expect(result.losses).toBeNull();
			expect(result.draws).toBeNull();
			expect(result.position).toBeNull();
			expect(result.points).toBeNull();
			expect(result.deckList).toBeNull();
			expect(result.lgs).toBeNull();
			expect(result.gameData).toBeNull();
		});
	});
});
