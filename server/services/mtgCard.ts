import type { DbCard, DbCardInsert } from '~~/server/db/schema';
import { sql } from 'drizzle-orm';
import { db } from 'hub:db';
import { cards } from '~~/server/db/schema';
import { chunkJsonRows } from '~~/server/utils/db';

export type UpsertCardInput = Omit<DbCardInsert, 'id' | 'createdAt' | 'updatedAt'>;

export function mtgCardService() {
	/**
	 * Batch upsert cards. Uses D1 batch API for a single round-trip.
	 * Returns a map of card name (lowercase) → DbCard.
	 */
	const batchUpsert = async (inputs: UpsertCardInput[]): Promise<Map<string, DbCard>> => {
		if (inputs.length === 0) {
			return new Map();
		}

		// Deduplicate by name (case-insensitive) — keep last seen
		const dedupedMap = new Map<string, UpsertCardInput>();
		for (const input of inputs) {
			dedupedMap.set(input.name.toLowerCase(), input);
		}
		const deduped = [...dedupedMap.values()];
		const writeAt = new Date();
		const writeAtMs = writeAt.getTime();
		const updateFields = [
			'scryfallId',
			'oracleId',
			'cardType',
			'colors',
			'cmc',
			'manaCost',
			'deckCounterTypes',
			'deckTokens',
		] as const;
		const grouped = new Map<string, UpsertCardInput[]>();
		for (const input of deduped) {
			const mask = updateFields.map(field => input[field] != null ? '1' : '0').join('');
			const rows = grouped.get(mask) ?? [];
			rows.push(input);
			grouped.set(mask, rows);
		}

		const queries = [...grouped.values()].flatMap((group) => {
			const example = group[0]!;
			const set = {
				...(example.scryfallId != null ? { scryfallId: sql.raw('excluded.scryfall_id') } : {}),
				...(example.oracleId != null ? { oracleId: sql.raw('excluded.oracle_id') } : {}),
				...(example.cardType != null ? { cardType: sql.raw('excluded.card_type') } : {}),
				...(example.colors != null ? { colors: sql.raw('excluded.colors') } : {}),
				...(example.cmc != null ? { cmc: sql.raw('excluded.cmc') } : {}),
				...(example.manaCost != null ? { manaCost: sql.raw('excluded.mana_cost') } : {}),
				...(example.deckCounterTypes != null ? { deckCounterTypes: sql.raw('excluded.deck_counter_types') } : {}),
				...(example.deckTokens != null ? { deckTokens: sql.raw('excluded.deck_tokens') } : {}),
				updatedAt: writeAt,
			};
			return chunkJsonRows(group.map(input => ({ ...input, game: input.game ?? 'mtg' }))).map(payload => db
				.insert(cards)
				.select(sql`
				select
					null,
					json_extract(value, '$.name'),
					coalesce(json_extract(value, '$.game'), 'mtg'),
					json_extract(value, '$.scryfallId'),
					json_extract(value, '$.oracleId'),
					json_extract(value, '$.cardType'),
					json_extract(value, '$.colors'),
					json_extract(value, '$.cmc'),
					json_extract(value, '$.manaCost'),
					coalesce(json_extract(value, '$.deckCounterTypes'), '[]'),
					coalesce(json_extract(value, '$.deckTokens'), '[]'),
					${writeAtMs},
					${writeAtMs}
				from json_each(${payload})
				where true
			`)
				.onConflictDoUpdate({
					target: [cards.name, cards.game],
					set,
				})
				.returning());
		});

		const batchResults = await db.batch(queries as [typeof queries[0], ...typeof queries]);
		const allCards = batchResults.flat();

		const nameToCard = new Map<string, DbCard>();
		for (const card of allCards) {
			nameToCard.set(card.name.toLowerCase(), card);
		}

		return nameToCard;
	};

	return {
		batchUpsert,
	};
}
