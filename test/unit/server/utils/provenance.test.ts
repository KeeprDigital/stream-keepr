import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { featureMatchSlots, matches, phases, players, rounds } from '~~/server/db/schema';
import { pickManualWritable, PROVENANCE_ENTITIES } from '~~/server/utils/provenance';

const TABLES = { players, phases, rounds, matches, featureMatchSlots } as const;

describe('provenance', () => {
	describe('column classification', () => {
		for (const [entity, table] of Object.entries(TABLES)) {
			it(`classifies every ${entity} column exactly once`, () => {
				const classification = PROVENANCE_ENTITIES[entity as keyof typeof PROVENANCE_ENTITIES];
				const allColumns = Object.keys(getTableColumns(table)).sort();
				const classified = [
					...classification.manualWritable,
					...classification.meleeOwned,
					...classification.serverManaged,
				].sort();

				expect(classified).toEqual(allColumns);
			});
		}

		it('never classifies Melee identity as manually writable', () => {
			for (const classification of Object.values(PROVENANCE_ENTITIES)) {
				expect(classification.manualWritable).not.toContain('externalId');
				expect(classification.manualWritable).not.toContain('externalSource');
			}
		});
	});

	describe('pickManualWritable', () => {
		it('strips Melee-owned and server-managed keys, keeps writable keys', () => {
			const picked = pickManualWritable('players', {
				name: 'Forger',
				externalId: 'forged-id',
				externalSource: 'melee',
				externalStatus: 2,
				isActive: false,
				lastSeenAt: new Date(0),
				id: 99,
				eventId: 7,
			});

			expect(picked).toEqual({ name: 'Forger' });
		});

		it('drops keys that are not classified as writable', () => {
			const picked = pickManualWritable('players', { name: 'A', bogus: 1 } as Record<string, unknown>);

			expect(picked).toEqual({ name: 'A' });
		});

		it('preserves explicit nulls and omits absent keys', () => {
			expect(pickManualWritable('players', { pronouns: null })).toEqual({ pronouns: null });
		});

		it('strips slot provenance and the active session pointer', () => {
			const picked = pickManualWritable('featureMatchSlots', {
				roundName: 'Finals',
				externalId: 'forged',
				externalSource: 'melee',
				activeSessionId: 12,
			});

			expect(picked).toEqual({ roundName: 'Finals' });
		});
	});
});
