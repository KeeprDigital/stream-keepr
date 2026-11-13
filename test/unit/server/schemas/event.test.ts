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
		['featureMatchDefaultCountUpLimit', 1, 600],
	])('bounds %s to %i..%i', (field, min, max) => {
		expect(schema.safeParse({ ...base, [field]: min }).success).toBe(true);
		expect(schema.safeParse({ ...base, [field]: max }).success).toBe(true);
		expect(schema.safeParse({ ...base, [field]: min - 1 }).success).toBe(false);
		expect(schema.safeParse({ ...base, [field]: max + 1 }).success).toBe(false);
	});

	// Unlike the extra turns label, a blank Untimed Label is meaningful: it shows nothing.
	it.each([
		['', true],
		[
			'x'.repeat(100),
			true,
		],
		[
			'x'.repeat(101),
			false,
		],
	])('bounds the Untimed Label %#, allowing it blank', (label, accepted) => {
		expect(schema.safeParse({ ...base, featureMatchDefaultUntimedLabel: label }).success).toBe(accepted);
	});

	// No count-up limit is a value of its own: the clock counts up without one.
	it('accepts a null count-up limit', () => {
		expect(schema.safeParse({ ...base, featureMatchDefaultCountUpLimit: null }).success).toBe(true);
	});

	it.each([
		['id', 123],
		['meleeClientSecret', 'secret'],
		['meleeSyncLeaseToken', 'token'],
		['meleeLiveResultsEnabled', true],
		['meleeLiveResultsBackoffStep', 0],
		['unexpected', true],
	])('refuses the server-managed or unknown %s rather than dropping it', (field, value) => {
		expect(schema.safeParse({ ...base, [field]: value }).success).toBe(false);
	});
});

describe('createEventSchema', () => {
	// Which Events hold Broadcast Deck Lists is `holdsBroadcastDeckLists`'s; the schema refuses by it.
	it('allows Broadcast Deck Lists only on an Event that holds them', () => {
		expect(createEventSchema.safeParse({ ...mtgEvent, broadcastDeckListsEnabled: true }).success).toBe(true);
		expect(createEventSchema.safeParse({ ...mtgEvent, variant: 'commander', broadcastDeckListsEnabled: true }).success).toBe(false);
	});

	// Only a Magic: The Gathering Event has a Variant, Two-Player unless it says Commander (ADR-0087).
	it.each([
		[
			{ game: 'mtg' },
			'two-player',
		],
		[
			{ game: 'mtg', variant: 'commander' },
			'commander',
		],
		[
			{ game: 'op' },
			null,
		],
	] as const)('creates %j with the Variant %s', (fields, variant) => {
		expect(createEventSchema.parse({ name: 'Event', ...fields }).variant).toBe(variant);
	});

	it('refuses a Variant on a One Piece Card Game Event', () => {
		expect(createEventSchema.safeParse({ name: 'One Piece', game: 'op', variant: 'two-player' }).success).toBe(false);
	});

	it('refuses commentator references, since a new Event has no Event Talent', () => {
		expect(createEventSchema.safeParse({ ...mtgEvent, commentator1TalentId: 42 }).success).toBe(false);
	});
});

describe('updateEventSchema', () => {
	// A Top N target is a placement, so at least 1; a minimum-points target may be 0.
	it.each([
		['topN', 0, false],
		['topN', 1, true],
		['topN', 999, true],
		['topN', 1000, false],
		['minPoints', -1, false],
		['minPoints', 0, true],
		['minPoints', 999, true],
		['minPoints', 1000, false],
	] as const)('bounds a %s conversion target of %i: %s', (conversionMetric, conversionThreshold, accepted) => {
		expect(updateEventSchema.safeParse({ conversionMetric, conversionThreshold }).success).toBe(accepted);
	});

	it.each([
		{ conversionMetric: 'topN' },
		{ conversionThreshold: 8 },
	])('refuses half a conversion target: %o', (half) => {
		expect(updateEventSchema.safeParse(half).success).toBe(false);
	});

	it('refuses to reinterpret an existing Event\'s game', () => {
		expect(updateEventSchema.safeParse({ game: 'op', name: 'Still MTG' }).success).toBe(false);
	});

	// Its Variant decides what an Event holds, as its Card Game does (ADR-0087).
	it('refuses to change an existing Event\'s Variant', () => {
		expect(updateEventSchema.safeParse({ variant: 'commander', name: 'Still Two-Player' }).success).toBe(false);
	});
});
