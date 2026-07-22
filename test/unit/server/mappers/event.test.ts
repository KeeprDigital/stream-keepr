import { describe, expect, it } from 'vitest';
import { mapEventListToResponse, mapEventToResponse } from '~~/server/mappers/event';
import { createMockEvent, createMockTalent } from '~~/test/helpers/fixtures';

describe('event mapper', () => {
	describe('mapEventListToResponse', () => {
		it('sets meleeConfigured to true when both client ID and secret are set', () => {
			const event = createMockEvent({
				meleeClientId: 'my-client-id',
				meleeClientSecret: 'my-client-secret',
			});
			const result = mapEventListToResponse(event);

			expect(result.meleeConfigured).toBe(true);
		});

		it('converts createdAt and updatedAt to Date instances', () => {
			const event = createMockEvent({
				createdAt: '2026-01-15T12:00:00.000Z' as unknown as Date,
				updatedAt: '2026-02-20T18:30:00.000Z' as unknown as Date,
				lastEventSyncedAt: '2026-02-20T19:30:00.000Z' as unknown as Date,
			});
			const result = mapEventListToResponse(event);

			expect(result.createdAt).toBeInstanceOf(Date);
			expect(result.updatedAt).toBeInstanceOf(Date);
			expect(result.lastEventSyncedAt).toBeInstanceOf(Date);
			expect(result.createdAt).toEqual(new Date('2026-01-15T12:00:00.000Z'));
			expect(result.updatedAt).toEqual(new Date('2026-02-20T18:30:00.000Z'));
			expect(result.lastEventSyncedAt).toEqual(new Date('2026-02-20T19:30:00.000Z'));
		});

		it('preserves Date objects that are already Date instances', () => {
			const created = new Date('2026-03-01T00:00:00.000Z');
			const updated = new Date('2026-03-02T00:00:00.000Z');
			const event = createMockEvent({ createdAt: created, updatedAt: updated });
			const result = mapEventListToResponse(event);

			expect(result.createdAt).toBeInstanceOf(Date);
			expect(result.updatedAt).toBeInstanceOf(Date);
			expect(result.createdAt).toEqual(created);
			expect(result.updatedAt).toEqual(updated);
		});

		it('preserves all other event fields in the response', () => {
			const event = createMockEvent({
				id: 42,
				name: 'Pro Tour',
				game: 'mtg',
				pointsSystem: '7ph',
			});
			const result = mapEventListToResponse(event);

			expect(result.id).toBe(42);
			expect(result.name).toBe('Pro Tour');
			expect(result.game).toBe('mtg');
			expect(result.pointsSystem).toBe('7ph');
		});

		it('does not expose internal Melee sync lease state', () => {
			const event = createMockEvent({
				meleeSyncLeaseToken: 'opaque-token',
				meleeSyncLeaseCommand: 'update',
				meleeSyncLeaseExpiresAt: new Date('2026-01-01T00:15:00.000Z'),
			});

			const result = mapEventListToResponse(event);

			expect(result).not.toHaveProperty('meleeSyncLeaseToken');
			expect(result).not.toHaveProperty('meleeSyncLeaseCommand');
			expect(result).not.toHaveProperty('meleeSyncLeaseExpiresAt');
		});
	});

	describe('mapEventToResponse', () => {
		it('sets meleeConfigured to true when both client ID and secret are set', () => {
			const event = {
				...createMockEvent({
					meleeClientId: 'id',
					meleeClientSecret: 'secret',
				}),
				talents: [],
			};
			const result = mapEventToResponse(event);

			expect(result.meleeConfigured).toBe(true);
		});

		it('converts createdAt and updatedAt to Date instances', () => {
			const event = {
				...createMockEvent({
					createdAt: '2026-06-01T10:00:00.000Z' as unknown as Date,
					updatedAt: '2026-06-02T14:00:00.000Z' as unknown as Date,
					initialSetupCompletedAt: '2026-06-02T15:00:00.000Z' as unknown as Date,
				}),
				talents: [],
			};
			const result = mapEventToResponse(event);

			expect(result.createdAt).toBeInstanceOf(Date);
			expect(result.updatedAt).toBeInstanceOf(Date);
			expect(result.initialSetupCompletedAt).toBeInstanceOf(Date);
			expect(result.createdAt).toEqual(new Date('2026-06-01T10:00:00.000Z'));
			expect(result.updatedAt).toEqual(new Date('2026-06-02T14:00:00.000Z'));
			expect(result.initialSetupCompletedAt).toEqual(new Date('2026-06-02T15:00:00.000Z'));
		});

		it('includes talents in the response', () => {
			const talent = createMockTalent({ id: 5, name: 'Cedric Phillips' });
			const event = {
				...createMockEvent(),
				talents: [talent],
			};
			const result = mapEventToResponse(event);

			expect(result.talents).toHaveLength(1);
			expect(result.talents[0].name).toBe('Cedric Phillips');
		});

		it('handles empty talents array', () => {
			const event = {
				...createMockEvent(),
				talents: [],
			};
			const result = mapEventToResponse(event);

			expect(result.talents).toEqual([]);
		});
	});
});
