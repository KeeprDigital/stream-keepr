import { describe, expect, it } from 'vitest';
import {
	meleeApiResponseSchema,
	meleeDecklistRecordSchema,
	meleeEventSchema,
	meleeMatchSchema,
	meleePlayerSchema,
	meleeStandingSchema,
} from '~~/server/schemas/external/melee';

// What the importer persists from Melee is bounded, so an upstream payload cannot
// corrupt aggregates or overflow stored text; what Melee may leave out is tolerated.

const record = {
	l: 'lightning-bolt',
	n: 'Lightning Bolt',
	s: 'lea',
	q: 4,
	c: 0,
	t: 'Instant',
};
const player = {
	TeamId: 12345,
	PlayerName: 'Alice',
	PronounsDescription: 'she/her',
	Decklists: [],
};
const match = {
	Guid: 'abc-123',
	TableNumber: 1,
	HasResult: false,
	ResultString: null,
	GameDraws: 0,
	ByeReason: null,
	Competitors: [
		{
			TeamId: 1,
			SortOrder: 0,
			GameWins: 2,
			Decklists: [],
		},
	],
};
const event = {
	ID: 123,
	Name: 'GP Melbourne',
	Game: 'Magic: The Gathering',
	Phases: [
		{
			ID: 1,
			Name: 'Swiss',
			FormatId: 'modern',
			SortOrder: 0,
			Rounds: [
				{ ID: 101, Name: 'Round 1', SortOrder: 0 },
			],
		},
	],
};

describe('persisted bounds', () => {
	it.each([
		[
			'a card quantity',
			meleeDecklistRecordSchema,
			(q: number) => ({ ...record, q }),
			1_000_000,
		],
		[
			'a player\'s pronouns',
			meleePlayerSchema,
			(length: number) => ({
				...player,
				PronounsDescription: 'x'.repeat(length),
			}),
			200,
		],
		[
			'a Match identity',
			meleeMatchSchema,
			(length: number) => ({
				...match,
				Guid: 'x'.repeat(length),
			}),
			100,
		],
		[
			'a Match result',
			meleeMatchSchema,
			(length: number) => ({
				...match,
				ResultString: 'x'.repeat(length),
			}),
			1_000,
		],
		[
			'an Event name',
			meleeEventSchema,
			(length: number) => ({
				...event,
				Name: 'x'.repeat(length),
			}),
			200,
		],
		[
			'a Phase name',
			meleeEventSchema,
			(length: number) => ({
				...event,
				Phases: [
					{
						...event.Phases[0],
						Name: 'x'.repeat(length),
					},
				],
			}),
			200,
		],
		[
			'an upstream game name',
			meleeEventSchema,
			(length: number) => ({
				...event,
				Game: 'x'.repeat(length),
			}),
			100,
		],
	] as const)('bounds %s', (_case, schema, at, max) => {
		expect((schema as typeof meleeEventSchema).safeParse(at(max)).success).toBe(true);
		expect((schema as typeof meleeEventSchema).safeParse(at(max + 1)).success).toBe(false);
	});

	it('accepts a zero card quantity and refuses a blank game name', () => {
		expect(meleeDecklistRecordSchema.safeParse({ ...record, q: 0 }).success).toBe(true);
		expect(meleeEventSchema.safeParse({ ...event, Game: ' ' }).success).toBe(false);
	});
});

describe('what Melee may leave out', () => {
	it('tolerates a player\'s missing or null metadata', () => {
		const minimal = meleePlayerSchema.parse({ TeamId: 1, PlayerName: 'Alice' });

		expect(minimal.PronounsDescription).toBeUndefined();
		expect(minimal.Status).toBeUndefined();
		expect(meleePlayerSchema.parse({ ...player, Status: null, PronounsDescription: null }).Status).toBeNull();
		expect(meleePlayerSchema.parse({ ...player, Decklists: null }).Decklists).toBeUndefined();
	});

	it('tolerates a null set code, table number and competitor game wins', () => {
		expect(meleeDecklistRecordSchema.parse({ ...record, s: null }).s).toBeNull();

		const pending = meleeMatchSchema.parse({
			...match,
			TableNumber: null,
			GameDraws: null,
			Competitors: [
				{
					TeamId: 1,
					SortOrder: 0,
					GameWins: null,
					Decklists: [],
				},
			],
		});
		expect(pending.TableNumber).toBeNull();
		expect(pending.Competitors[0]?.GameWins).toBeNull();
	});

	it('keeps Match and competitor deck format references', () => {
		const result = meleeMatchSchema.parse({
			...match,
			FormatId: 'standard',
			Competitors: [
				{
					TeamId: 1,
					SortOrder: 0,
					GameWins: null,
					Decklists: [
						{ DecklistId: 'deck-guid', PlayerId: 10, FormatId: 'standard' },
					],
				},
			],
		});

		expect(result.FormatId).toBe('standard');
		expect(result.Competitors[0]?.Decklists[0]?.FormatId).toBe('standard');
	});
});

describe('meleeApiResponseSchema', () => {
	it('requires the pagination metadata used to prove snapshot completeness', () => {
		const schema = meleeApiResponseSchema(meleeStandingSchema);
		const standing = {
			TeamId: 1,
			Rank: 1,
			Points: 18,
			MatchWins: 6,
			MatchLosses: 0,
			MatchDraws: 0,
		};

		expect(schema.safeParse({
			Page: 1,
			PageSize: 100,
			RecordsFiltered: 1,
			RecordsTotal: 1,
			Content: [standing],
			HasMore: false,
		}).success).toBe(true);
		expect(schema.safeParse({ Content: [], HasMore: false }).success).toBe(false);
	});
});
