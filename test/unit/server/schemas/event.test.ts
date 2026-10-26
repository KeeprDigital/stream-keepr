import { describe, expect, it } from 'vitest';
import { createEventSchema, updateEventSchema } from '~~/server/schemas/api/event';

const mtgEvent = { name: 'Pro Tour Chicago', game: 'mtg' as const };

describe.each([
	['createEventSchema', createEventSchema, mtgEvent],
	['updateEventSchema', updateEventSchema, {}],
] as const)('%s', (_name, schema, base) => {
	it.each([
		['numFeatureMatches', 1, 50],
		['featureMatchDefaultBestOf', 1, 9],
		['cardTimeout', 0, 300],
		['featureMatchDefaultStartingLife', 0, 99_999],
		['featureMatchDefaultClockDuration', 0, 999],
		['featureMatchDefaultExtraTurns', 0, 20],
	])('bounds %s to %i..%i', (field, min, max) => {
		expect(schema.safeParse({ ...base, [field]: min }).success).toBe(true);
		expect(schema.safeParse({ ...base, [field]: max }).success).toBe(true);
		expect(schema.safeParse({ ...base, [field]: min - 1 }).success).toBe(false);
		expect(schema.safeParse({ ...base, [field]: max + 1 }).success).toBe(false);
	});

	it.each([
		['id', 123],
		['meleeClientSecret', 'secret'],
		['meleeSyncLeaseToken', 'token'],
		['unexpected', true],
	])('refuses the server-managed or unknown %s rather than dropping it', (field, value) => {
		expect(schema.safeParse({ ...base, [field]: value }).success).toBe(false);
	});
});

describe('createEventSchema', () => {
	it('allows Broadcast Deck Lists only for MTG Events', () => {
		expect(createEventSchema.safeParse({ ...mtgEvent, broadcastDeckListsEnabled: true }).success).toBe(true);
		expect(createEventSchema.safeParse({ name: 'One Piece', game: 'op', broadcastDeckListsEnabled: true }).success).toBe(false);
	});

	it('refuses commentator references, since a new Event has no Event Talent', () => {
		expect(createEventSchema.safeParse({ ...mtgEvent, commentator1TalentId: 42 }).success).toBe(false);
	});
});

describe('updateEventSchema', () => {
	it('refuses to reinterpret an existing Event\'s game', () => {
		expect(updateEventSchema.safeParse({ game: 'op', name: 'Still MTG' }).success).toBe(false);
	});
});
