/**
 * Runtime Zod schemas for Scryfall API responses.
 *
 * Only the fields consumed by `server/utils/scryfall.ts` are validated.
 * All schemas use `.passthrough()` so additional Scryfall fields (of which
 * there are many) do not cause parse failures.
 */

import { z } from 'zod';

// ── Card face (for double-faced / transform cards) ───────────────────────────

export const scryfallCardFaceSchema = z.object({
	/** null on back faces of some DFCs */
	mana_cost: z.string().max(500).nullable().optional(),
	oracle_text: z.string().max(50_000).nullable().optional(),
}).passthrough();

const scryfallRelatedCardSchema = z.object({
	id: z.string().max(100).nullable().optional(),
	component: z.string().max(50).nullable().optional(),
	name: z.string().max(500).nullable().optional(),
	type_line: z.string().max(500).nullable().optional(),
	uri: z.string().max(2_048).nullable().optional(),
}).passthrough();

// ── Individual card ───────────────────────────────────────────────────────────

export const scryfallCardSchema = z.object({
	/** Scryfall card ID (UUID in production; string here to allow test stubs) */
	id: z.string().min(1).max(100),
	/** Card name — may include " // " for double-faced cards */
	name: z.string().min(1).max(500),
	/** Three-letter set code */
	set: z.string().min(1).max(20),
	/** Mana cost string e.g. "{1}{W}{W}" — null for lands / colorless permanents */
	mana_cost: z.string().max(500).nullable().optional(),
	/** Converted mana cost — null for tokens and emblems that have no mana value */
	cmc: z.number().nullable().optional(),
	/** Color identity array — null on some token/emblem records */
	color_identity: z.array(z.string().max(10)).max(10).nullable().optional(),
	/** Full type line — null on some token subtypes */
	type_line: z.string().max(500).nullable().optional(),
	/** Rules fields consumed when deriving player counters. */
	oracle_text: z.string().max(50_000).nullable().optional(),
	keywords: z.array(z.string().max(100)).max(100).nullable().optional(),
	/** Card faces for double-faced cards */
	card_faces: z.array(scryfallCardFaceSchema).max(10).nullable().optional(),
	/** Related token parts consumed when deriving deck token requirements. */
	all_parts: z.array(scryfallRelatedCardSchema).max(100).nullable().optional(),
}).passthrough();

// ── Collection response ───────────────────────────────────────────────────────

export const scryfallCollectionResponseSchema = z.object({
	object: z.literal('list'),
	not_found: z.array(
		z.object({ name: z.string().max(500) }).passthrough(),
	).max(75),
	data: z.array(scryfallCardSchema).max(75),
}).passthrough();

// ── Inferred types ────────────────────────────────────────────────────────────

export type ScryfallCardParsed = z.infer<typeof scryfallCardSchema>;
export type ScryfallCollectionResponseParsed = z.infer<typeof scryfallCollectionResponseSchema>;
