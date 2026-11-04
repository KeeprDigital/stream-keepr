import type { SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { OpCardColor, OpCardSummary, OpCatalogueCard } from '~~/shared/types/card/op';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '~~/server/db';
import { cards } from '~~/server/db/schema';
import { chunkJsonRows, inJsonArray, selectForInsert } from '~~/server/utils/db';
import { OP_CARD_COLORS } from '~~/shared/types/card/op';

/**
 * The card catalogue's One Piece rows, keyed by card number (ADR-0074). A row
 * is written once, from bandai-keepr, and never refreshed.
 */

function isOpCardColor(value: unknown): value is OpCardColor {
	return (OP_CARD_COLORS as readonly unknown[]).includes(value);
}

/** One Piece colours are kept in the shared `colors` column as a JSON array. */
/** A catalogue row's One Piece colours, stored as a JSON array. */
export function decodeOpCatalogueColors(stored: string | null): OpCardColor[] {
	try {
		const parsed: unknown = JSON.parse(stored ?? '[]');
		return Array.isArray(parsed)
			? parsed.filter(isOpCardColor)
			: [];
	}
	catch {
		return [];
	}
}

/** The columns an entry reading the catalogue selects, by a left join on its number. */
export const opCatalogueCardColumns = {
	catalogueName: cards.name,
	category: cards.category,
	colors: cards.colors,
	cost: cards.cost,
	power: cards.power,
	counter: cards.counter,
	imageUrl: cards.imageUrl,
};

/** The join condition naming the One Piece catalogue row with `number`. */
export function opCatalogueRowFor(number: SQLiteColumn | SQL | string): SQL {
	return and(eq(cards.game, 'op'), eq(cards.cardNumber, number))!;
}

interface OpCatalogueColumns {
	catalogueName: string | null;
	category: OpCatalogueCard['category'] | null;
	colors: string | null;
	cost: number | null;
	power: number | null;
	counter: number | null;
	imageUrl: string | null;
}

/** The card a joined row names, or `null` when the catalogue has none for the number. */
export function toOpCatalogueCard(row: OpCatalogueColumns): OpCatalogueCard | null {
	if (row.catalogueName === null || row.category === null || row.imageUrl === null)
		return null;
	return {
		name: row.catalogueName,
		category: row.category,
		colors: decodeOpCatalogueColors(row.colors),
		cost: row.cost,
		power: row.power,
		counter: row.counter,
		imageUrl: row.imageUrl,
	};
}

export function opCardCatalogueService() {
	/** The catalogue's cards among `numbers`, by number; a number it lacks is absent. */
	const findByNumbers = async (numbers: readonly string[]): Promise<Map<string, OpCatalogueCard>> => {
		if (numbers.length === 0)
			return new Map();
		const rows = await db.select({ number: cards.cardNumber, ...opCatalogueCardColumns })
			.from(cards)
			.where(and(eq(cards.game, 'op'), inJsonArray(cards.cardNumber, [...numbers])));
		const found = new Map<string, OpCatalogueCard>();
		for (const row of rows) {
			const card = toOpCatalogueCard(row);
			if (row.number && card)
				found.set(row.number, card);
		}
		return found;
	};

	/** Adds the cards bandai-keepr answered; a number the catalogue already holds keeps its row. */
	const add = async (answered: readonly OpCardSummary[]): Promise<void> => {
		const rows = answered.map(card => ({
			name: card.name,
			number: card.number,
			category: card.category,
			colors: JSON.stringify(card.colors.filter(isOpCardColor)),
			cost: card.cost,
			power: card.power,
			counter: card.counter,
			imageUrl: card.imageUrl,
		}));
		const writeAtMs = Date.now();
		const [first, ...rest] = chunkJsonRows(rows).map(payload => db
			.insert(cards)
			.select(selectForInsert(cards, {
				id: sql`null`,
				name: sql`json_extract(value, '$.name')`,
				game: sql`'op'`,
				scryfallId: sql`null`,
				oracleId: sql`null`,
				cardType: sql`null`,
				colors: sql`json_extract(value, '$.colors')`,
				cmc: sql`null`,
				manaCost: sql`null`,
				deckCounterTypes: sql`'[]'`,
				deckTokens: sql`'[]'`,
				cardNumber: sql`json_extract(value, '$.number')`,
				category: sql`json_extract(value, '$.category')`,
				cost: sql`json_extract(value, '$.cost')`,
				power: sql`json_extract(value, '$.power')`,
				counter: sql`json_extract(value, '$.counter')`,
				imageUrl: sql`json_extract(value, '$.imageUrl')`,
				createdAt: sql`${writeAtMs}`,
				updatedAt: sql`${writeAtMs}`,
			}, sql`from json_each(${payload}) where true`))
			.onConflictDoNothing());
		if (first)
			await db.batch([first, ...rest]);
	};

	return { findByNumbers, add };
}
