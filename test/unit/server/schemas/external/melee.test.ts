import { describe, expect, it } from 'vitest';
import {
	meleeApiResponseSchema,
	meleeDecklistRecordSchema,
	meleeEventSchema,
	meleeMatchSchema,
	meleePlayerSchema,
	meleeStandingSchema,
} from '~~/server/schemas/external/melee';

// ── meleeDecklistRecordSchema ─────────────────────────────────────────────────

describe('meleeDecklistRecordSchema', () => {
	const validRecord = { l: 'lightning-bolt', n: 'Lightning Bolt', s: 'lea', q: 4, c: 0, t: 'Instant' };

	it('accepts a valid record', () => {
		expect(meleeDecklistRecordSchema.parse(validRecord)).toEqual(validRecord);
	});

	it('passes through unknown fields (passthrough)', () => {
		const withExtra = { ...validRecord, extraField: 'ignored' };
		const result = meleeDecklistRecordSchema.parse(withExtra);
		expect(result).toHaveProperty('extraField', 'ignored');
	});

	it('accepts quantity at boundary values 0 and 100', () => {
		expect(meleeDecklistRecordSchema.parse({ ...validRecord, q: 0 }).q).toBe(0);
		expect(meleeDecklistRecordSchema.parse({ ...validRecord, q: 100 }).q).toBe(100);
	});

	it('accepts null set code', () => {
		expect(meleeDecklistRecordSchema.parse({ ...validRecord, s: null }).s).toBeNull();
	});
});

// ── meleePlayerSchema ─────────────────────────────────────────────────────────

describe('meleePlayerSchema', () => {
	const validPlayer = {
		TeamId: 12345,
		PlayerName: 'Alice',
		PronounsDescription: 'she/her',
		Decklists: [],
	};

	it('accepts a valid player', () => {
		expect(meleePlayerSchema.parse(validPlayer)).toEqual(validPlayer);
	});

	it('accepts null PronounsDescription', () => {
		expect(meleePlayerSchema.parse({ ...validPlayer, PronounsDescription: null }).PronounsDescription).toBeNull();
	});

	it('accepts an optional integer tournament status', () => {
		expect(meleePlayerSchema.parse({ ...validPlayer, Status: 7 }).Status).toBe(7);
		expect(meleePlayerSchema.parse(validPlayer).Status).toBeUndefined();
	});

	it('passes through unknown fields', () => {
		const result = meleePlayerSchema.parse({ ...validPlayer, DisplayName: 'Alice J.' });
		expect(result).toHaveProperty('DisplayName', 'Alice J.');
	});

	it('rejects oversized consumed player strings', () => {
		expect(meleePlayerSchema.safeParse({ ...validPlayer, PronounsDescription: 'x'.repeat(201) }).success).toBe(false);
	});
});

// ── meleeStandingSchema ───────────────────────────────────────────────────────

describe('meleeStandingSchema', () => {
	const validStanding = {
		TeamId: 1,
		Rank: 1,
		Points: 18,
		MatchWins: 6,
		MatchLosses: 0,
		MatchDraws: 0,
	};

	it('accepts a valid standing', () => {
		expect(meleeStandingSchema.parse(validStanding)).toEqual(validStanding);
	});

	it('passes through unknown fields', () => {
		const result = meleeStandingSchema.parse({ ...validStanding, GameWins: 12 });
		expect(result).toHaveProperty('GameWins', 12);
	});
});

// ── meleeMatchSchema ──────────────────────────────────────────────────────────

describe('meleeMatchSchema', () => {
	const validMatch = {
		Guid: 'abc-123',
		TableNumber: 1,
		HasResult: false,
		ResultString: null,
		GameDraws: 0,
		ByeReason: null,
		Competitors: [
			{ TeamId: 1, SortOrder: 0, GameWins: 2, Decklists: [] },
		],
	};

	it('accepts a valid match', () => {
		expect(meleeMatchSchema.parse(validMatch)).toEqual(validMatch);
	});

	it('validates consumed result fields and passes through unknown fields', () => {
		const result = meleeMatchSchema.parse({ ...validMatch, HasResult: true, AdminResultString: '2-0' });
		expect(result).toHaveProperty('HasResult', true);
		expect(result).toHaveProperty('AdminResultString', '2-0');
	});

	it('accepts null table numbers and competitor game wins', () => {
		const result = meleeMatchSchema.parse({
			Guid: 'abc-456',
			TableNumber: null,
			HasResult: false,
			ResultString: null,
			GameDraws: null,
			ByeReason: null,
			Competitors: [
				{ TeamId: 1, SortOrder: 0, GameWins: null, Decklists: [] },
			],
		});

		expect(result.TableNumber).toBeNull();
		expect(result.Competitors[0]?.GameWins).toBeNull();
	});

	it('validates match and competitor deck format references', () => {
		const result = meleeMatchSchema.parse({
			...validMatch,
			FormatId: 'standard',
			Competitors: [{
				TeamId: 1,
				SortOrder: 0,
				GameWins: null,
				Decklists: [{ DecklistId: 'deck-guid', PlayerId: 10, FormatId: 'standard' }],
			}],
		});

		expect(result.FormatId).toBe('standard');
		expect(result.Competitors[0]?.Decklists[0]?.FormatId).toBe('standard');
	});

	it('rejects oversized persisted match identifiers and result text', () => {
		expect(meleeMatchSchema.safeParse({ ...validMatch, Guid: 'x'.repeat(101) }).success).toBe(false);
		expect(meleeMatchSchema.safeParse({ ...validMatch, ResultString: 'x'.repeat(1_001) }).success).toBe(false);
	});
});

// ── meleeEventSchema ──────────────────────────────────────────────────────────

describe('meleeEventSchema', () => {
	const validEvent = {
		ID: 123,
		Name: 'GP Melbourne',
		Game: 'Magic: The Gathering',
		Phases: [
			{ ID: 1, Name: 'Swiss', FormatId: 'modern', SortOrder: 0, Rounds: [{ ID: 101, Name: 'Round 1', SortOrder: 0 }] },
		],
	};

	it('accepts a valid event', () => {
		expect(meleeEventSchema.parse(validEvent)).toEqual(validEvent);
	});

	it('passes through unknown fields', () => {
		const result = meleeEventSchema.parse({ ...validEvent, Guid: 'event-guid' });
		expect(result).toHaveProperty('Guid', 'event-guid');
	});

	it('rejects oversized event structure names', () => {
		expect(meleeEventSchema.safeParse({ ...validEvent, Name: 'x'.repeat(201) }).success).toBe(false);
		expect(meleeEventSchema.safeParse({
			...validEvent,
			Phases: [{ ...validEvent.Phases[0], Name: 'x'.repeat(201) }],
		}).success).toBe(false);
	});

	it('requires a bounded upstream game name', () => {
		expect(meleeEventSchema.safeParse({ ...validEvent, Game: '' }).success).toBe(false);
		expect(meleeEventSchema.safeParse({ ...validEvent, Game: 'x'.repeat(101) }).success).toBe(false);
	});
});

// ── meleeApiResponseSchema ────────────────────────────────────────────────────

describe('meleeApiResponseSchema', () => {
	it('wraps item schema and validates Content array', () => {
		const schema = meleeApiResponseSchema(meleeStandingSchema);
		const data = {
			Page: 1,
			PageSize: 100,
			RecordsFiltered: 1,
			RecordsTotal: 1,
			Content: [
				{ TeamId: 1, Rank: 1, Points: 18, MatchWins: 6, MatchLosses: 0, MatchDraws: 0 },
			],
			HasMore: false,
		};
		expect(schema.parse(data)).toEqual(data);
	});

	it('requires the pagination metadata used to prove snapshot completeness', () => {
		const schema = meleeApiResponseSchema(meleeStandingSchema);
		expect(schema.safeParse({ Content: [], HasMore: false }).success).toBe(false);
	});
});
