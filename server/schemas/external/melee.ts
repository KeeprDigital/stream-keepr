/**
 * Runtime Zod schemas for Melee.gg API responses.
 *
 * Only the fields we actually consume are validated. All schemas use
 * `.passthrough()` so unknown fields from Melee do not cause parse failures.
 *
 * These schemas are used inside `server/services/melee.ts` to validate raw
 * `response.json()` values at the external API boundary before any code
 * touches them. The inferred `*Parsed` types below are the authoritative
 * compile-time types for validated Melee data.
 */

import { z } from 'zod';

// ── Sub-schemas ──────────────────────────────────────────────────────────────

/** Paginated response wrapper used by all list endpoints. */
export function meleeApiResponseSchema<S extends z.ZodTypeAny>(contentSchema: S) {
	return z.object({
		Page: z.number().int().positive(),
		PageSize: z.number().int().positive().max(1_000),
		RecordsFiltered: z.number().int().nonnegative().safe(),
		RecordsTotal: z.number().int().nonnegative().safe(),
		Content: z.array(contentSchema).max(1_000),
		HasMore: z.boolean(),
	}).passthrough();
}

/** Deck list card record — bounds-checks quantity to guard against data corruption. */
export const meleeDecklistRecordSchema = z.object({
	/** Slug / lookup key */
	l: z.string().max(200),
	/** Card name */
	n: z.string().max(200),
	/** Set code */
	s: z.string().max(10).nullable(),
	/** Quantity — clamped 0–100 to prevent stats corruption */
	q: z.number().int().min(0).max(100),
	/** Compartment code: 0 = mainboard, 99 = sideboard */
	c: z.number().int(),
	/** Card type line */
	t: z.string().max(200),
}).passthrough();

/** Deck list attribute (color, archetype tags). */
export const meleeDecklistAttributeSchema = z.object({
	k: z.string().max(200),
	v: z.string().max(1_000),
	/** Priority/sort — may be absent on some attribute types */
	p: z.number().nullable().optional(),
}).passthrough();

/** Player decklist as it appears on a player record — only consumed fields validated. */
export const meleePlayerDecklistSchema = z.object({
	Guid: z.string().min(1).max(100),
	DecklistName: z.string().max(200),
	Records: z.array(meleeDecklistRecordSchema).max(500),
	Attributes: z.array(meleeDecklistAttributeSchema).max(100),
	FormatId: z.string().min(1).max(100),
}).passthrough();

/** Player as returned from GET /api/player/list/{eventId} */
export const meleePlayerSchema = z.object({
	TeamId: z.number().int(),
	PlayerName: z.string().max(200),
	PronounsDescription: z.string().max(200).nullable(),
	/** Raw Melee tournament-player status. Numeric meanings are not publicly stable. */
	Status: z.number().int().optional(),
	/** Absent when a player has not yet submitted a decklist */
	Decklists: z.array(meleePlayerDecklistSchema).max(20).optional(),
}).passthrough();

/** Standing as returned from GET /api/standing/list/ */
export const meleeStandingSchema = z.object({
	TeamId: z.number().int(),
	Rank: z.number().int(),
	Points: z.number(),
	MatchWins: z.number().int(),
	MatchLosses: z.number().int(),
	MatchDraws: z.number().int(),
}).passthrough();

/** Competitor nested inside a match record. */
export const meleeMatchCompetitorSchema = z.object({
	TeamId: z.number().int(),
	SortOrder: z.number().int(),
	GameWins: z.number().int().nullable(),
	Decklists: z.array(
		z.object({
			DecklistId: z.string().min(1).max(100),
			PlayerId: z.number().int(),
			FormatId: z.string().min(1).max(100).optional(),
		}).passthrough(),
	).max(20),
}).passthrough();

/** Match as returned from GET /api/match/list/round/{roundId} */
export const meleeMatchSchema = z.object({
	Guid: z.string().min(1).max(100),
	TableNumber: z.number().int().nullable(),
	Competitors: z.array(meleeMatchCompetitorSchema).max(16),
	HasResult: z.boolean(),
	ResultString: z.string().max(1_000).nullable(),
	GameDraws: z.number().int().nullable(),
	ByeReason: z.number().int().nullable(),
	FormatId: z.string().min(1).max(100).optional(),
}).passthrough();

/** Phase round as nested inside a MeleeEventPhase. */
export const meleeEventPhaseRoundSchema = z.object({
	ID: z.number().int(),
	Name: z.string().max(200),
	SortOrder: z.number().int(),
}).passthrough();

/** Phase as nested inside a MeleeEvent. */
export const meleeEventPhaseSchema = z.object({
	ID: z.number().int(),
	Name: z.string().max(200),
	FormatId: z.string().min(1).max(100),
	SortOrder: z.number().int(),
	Rounds: z.array(meleeEventPhaseRoundSchema).max(1_000),
}).passthrough();

/** Tournament event as returned from GET /api/tournament/{eventId} */
export const meleeEventSchema = z.object({
	ID: z.number().int(),
	Name: z.string().max(200),
	Game: z.string().trim().min(1).max(100),
	Phases: z.array(meleeEventPhaseSchema).max(100),
}).passthrough();

// ── Inferred types ────────────────────────────────────────────────────────────

export type MeleeDecklistRecordParsed = z.infer<typeof meleeDecklistRecordSchema>;
export type MeleePlayerDecklistParsed = z.infer<typeof meleePlayerDecklistSchema>;
export type MeleePlayerParsed = z.infer<typeof meleePlayerSchema>;
export type MeleeStandingParsed = z.infer<typeof meleeStandingSchema>;
export type MeleeMatchParsed = z.infer<typeof meleeMatchSchema>;
export type MeleeMatchCompetitorParsed = z.infer<typeof meleeMatchCompetitorSchema>;
export type MeleeEventParsed = z.infer<typeof meleeEventSchema>;
