import type { BroadcastDeckListAggregate, BroadcastDeckListSummaryRow } from '~~/server/mappers/broadcastDeckList';
import type { BroadcastDeckListCanonicalDocument } from '~~/server/modules/broadcast-deck-list-import';
import type { BroadcastDeckListAffectedScreen, BroadcastDeckListResponse, BroadcastDeckListSummaryResponse, CreateBroadcastDeckListInput, UpdateBroadcastDeckListInput } from '~~/shared/types/broadcastDeckList';
import { and, asc, eq, getTableColumns, sql } from 'drizzle-orm';
import { db } from 'hub:db';
import { broadcastDeckListEntries, broadcastDeckLists, events } from '~~/server/db/schema';
import { mapBroadcastDeckListDetail, mapBroadcastDeckListSummary } from '~~/server/mappers/broadcastDeckList';
import { cleanBroadcastDeckListName, normalizeBroadcastDeckListName } from '~~/shared/utils/broadcastDeckList';

export class BroadcastDeckListNameConflict extends Error {
	constructor() {
		super('A Broadcast Deck List with this name already exists in this Event');
		this.name = 'BroadcastDeckListNameConflict';
	}
}

export type BroadcastDeckListMutationResult
	= | { status: 'updated'; item: BroadcastDeckListResponse }
		| { status: 'conflict'; current: BroadcastDeckListResponse }
		| { status: 'missing' };

export type BroadcastDeckListDeleteResult
	= | { status: 'deleted' }
		| { status: 'conflict'; current: BroadcastDeckListResponse }
		| { status: 'in-use'; current: BroadcastDeckListResponse; screens: BroadcastDeckListAffectedScreen[] }
		| { status: 'missing' };

const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G'] as const;

function normalizeColors(colors: string | null | undefined): string | null | undefined {
	if (colors === undefined)
		return undefined;
	if (colors === null || colors === '')
		return null;
	const selected = new Set(colors.toUpperCase());
	return COLOR_ORDER.filter(color => selected.has(color)).join('');
}

function normalizedLabel(label: string | null | undefined): string | null | undefined {
	if (label === undefined)
		return undefined;
	const trimmed = label?.trim() ?? '';
	return trimmed.length === 0 ? null : trimmed;
}

function documentEntries(document: BroadcastDeckListCanonicalDocument) {
	return [
		...document.mainboard.map(entry => ({ compartment: 'mainboard' as const, ...entry })),
		...document.sideboard.map(entry => ({ compartment: 'sideboard' as const, ...entry })),
		...(document.companion ? [{ compartment: 'companion' as const, ...document.companion }] : []),
	];
}

function entryInsertStatement(
	client: typeof db.$client,
	listId: number | null,
	document: BroadcastDeckListCanonicalDocument,
	options: { operationVersion?: string } = {},
) {
	const operationGuard = options.operationVersion && listId !== null
		? 'WHERE EXISTS (SELECT 1 FROM broadcast_deck_lists WHERE id = ? AND operation_version = ?)'
		: '';
	const createdListIdentity = listId === null
		? 'WITH created_list(id) AS MATERIALIZED (SELECT last_insert_rowid())'
		: '';
	const listIdSql = listId === null ? 'created_list.id' : '?';
	const createdListJoin = listId === null ? ', created_list' : '';
	const now = Date.now();
	const rows = documentEntries(document);
	return client.prepare(`
		${createdListIdentity}
		INSERT INTO broadcast_deck_list_entries (
			list_id, compartment, quantity, sort_order, canonical_name,
			scryfall_id, oracle_id, set_code, collector_number, card_type,
			colors, mana_cost, mana_value, deck_counter_types, created_at, updated_at
		)
		SELECT
			${listIdSql},
			json_extract(value, '$.compartment'),
			cast(json_extract(value, '$.quantity') as integer),
			cast(json_extract(value, '$.sortOrder') as integer),
			json_extract(value, '$.canonicalName'),
			json_extract(value, '$.scryfallId'),
			json_extract(value, '$.oracleId'),
			json_extract(value, '$.setCode'),
			json_extract(value, '$.collectorNumber'),
			json_extract(value, '$.cardType'),
			json_extract(value, '$.colors'),
			json_extract(value, '$.manaCost'),
			json_extract(value, '$.manaValue'),
			json_extract(value, '$.deckCounterTypes'),
			?, ?
		FROM json_each(?)${createdListJoin}
		${operationGuard}
	`).bind(
		...(listId === null ? [] : [listId]),
		now,
		now,
		JSON.stringify(rows),
		...(options.operationVersion && listId !== null ? [listId, options.operationVersion] : []),
	);
}

function isListNameConflict(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes('broadcast_deck_lists.event_id')
		&& message.includes('broadcast_deck_lists.normalized_name');
}

interface StoredDetailRow {
	id: number;
	eventId: number;
	name: string;
	normalizedName: string;
	sourceText: string;
	archetypeLabel: string | null;
	colors: string | null;
	revision: number;
	operationVersion: string | null;
	createdAt: number;
	updatedAt: number;
	entries: string;
}

function detailSelectStatement(
	client: typeof db.$client,
	where: 'identity' | 'operation',
	first: number,
	second: number | string,
) {
	const condition = where === 'identity'
		? 'lists.id = ? AND lists.event_id = ?'
		: 'lists.event_id = ? AND lists.operation_version = ?';
	return client.prepare(`
		SELECT
			lists.id AS id,
			lists.event_id AS eventId,
			lists.name AS name,
			lists.normalized_name AS normalizedName,
			lists.source_text AS sourceText,
			lists.archetype_label AS archetypeLabel,
			lists.colors AS colors,
			lists.revision AS revision,
			lists.operation_version AS operationVersion,
			lists.created_at AS createdAt,
			lists.updated_at AS updatedAt,
			coalesce((
				SELECT json_group_array(json(ordered.entry))
				FROM (
					SELECT json_object(
						'id', entries.id,
						'listId', entries.list_id,
						'compartment', entries.compartment,
						'quantity', entries.quantity,
						'sortOrder', entries.sort_order,
						'canonicalName', entries.canonical_name,
						'scryfallId', entries.scryfall_id,
						'oracleId', entries.oracle_id,
						'setCode', entries.set_code,
						'collectorNumber', entries.collector_number,
						'cardType', entries.card_type,
						'colors', entries.colors,
						'manaCost', entries.mana_cost,
						'manaValue', entries.mana_value,
						'deckCounterTypes', json(entries.deck_counter_types),
						'createdAt', entries.created_at,
						'updatedAt', entries.updated_at
					) AS entry
					FROM broadcast_deck_list_entries AS entries
					WHERE entries.list_id = lists.id
					ORDER BY
						case entries.compartment when 'mainboard' then 0 when 'sideboard' then 1 else 2 end,
						entries.sort_order,
						entries.id
				) AS ordered
			), '[]') AS entries
		FROM broadcast_deck_lists AS lists
		WHERE ${condition}
	`).bind(first, second);
}

function mapStoredDetail(result: D1Result<StoredDetailRow>): BroadcastDeckListResponse | undefined {
	const [row] = result.results;
	if (!row)
		return undefined;
	const entries = (JSON.parse(row.entries) as Array<Record<string, unknown>>).map(entry => ({
		...entry,
		createdAt: new Date(Number(entry.createdAt)),
		updatedAt: new Date(Number(entry.updatedAt)),
	})) as BroadcastDeckListAggregate['entries'];
	return mapBroadcastDeckListDetail({
		...row,
		createdAt: new Date(Number(row.createdAt)),
		updatedAt: new Date(Number(row.updatedAt)),
		entries,
	});
}

export function broadcastDeckListService() {
	const findByEventId = async (eventId: number): Promise<BroadcastDeckListSummaryResponse[]> => {
		const rows = await db
			.select({
				...getTableColumns(broadcastDeckLists),
				mainboardQuantity: sql<number>`coalesce(sum(case when ${broadcastDeckListEntries.compartment} = 'mainboard' then ${broadcastDeckListEntries.quantity} else 0 end), 0)`,
				sideboardQuantity: sql<number>`coalesce(sum(case when ${broadcastDeckListEntries.compartment} = 'sideboard' then ${broadcastDeckListEntries.quantity} else 0 end), 0)`,
				hasCompanion: sql<boolean>`max(case when ${broadcastDeckListEntries.compartment} = 'companion' then 1 else 0 end)`,
			})
			.from(broadcastDeckLists)
			.leftJoin(broadcastDeckListEntries, eq(broadcastDeckListEntries.listId, broadcastDeckLists.id))
			.where(eq(broadcastDeckLists.eventId, eventId))
			.groupBy(broadcastDeckLists.id)
			.orderBy(asc(broadcastDeckLists.normalizedName), asc(broadcastDeckLists.id));

		return (rows as BroadcastDeckListSummaryRow[]).map(mapBroadcastDeckListSummary);
	};

	const findAggregateById = async (id: number, eventId: number): Promise<BroadcastDeckListAggregate | undefined> => {
		const rows = await db
			.select({ list: broadcastDeckLists, entry: broadcastDeckListEntries })
			.from(broadcastDeckLists)
			.leftJoin(broadcastDeckListEntries, eq(broadcastDeckListEntries.listId, broadcastDeckLists.id))
			.where(and(eq(broadcastDeckLists.id, id), eq(broadcastDeckLists.eventId, eventId)))
			.orderBy(
				sql`case ${broadcastDeckListEntries.compartment} when 'mainboard' then 0 when 'sideboard' then 1 else 2 end`,
				asc(broadcastDeckListEntries.sortOrder),
				asc(broadcastDeckListEntries.id),
			);
		const [first] = rows;
		if (!first)
			return undefined;
		return {
			...first.list,
			entries: rows.flatMap(row => row.entry ? [row.entry] : []),
		};
	};

	const findById = async (id: number, eventId: number): Promise<BroadcastDeckListResponse | undefined> => {
		const list = await findAggregateById(id, eventId);
		return list ? mapBroadcastDeckListDetail(list) : undefined;
	};

	const findEventGame = async (eventId: number): Promise<'mtg' | 'op' | undefined> => {
		const [event] = await db.select({ game: events.game }).from(events).where(eq(events.id, eventId)).limit(1);
		return event?.game;
	};

	const sourceIsSelectable = async (id: number, eventId: number): Promise<boolean> => {
		const [list] = await db
			.select({ id: broadcastDeckLists.id })
			.from(broadcastDeckLists)
			.innerJoin(events, eq(events.id, broadcastDeckLists.eventId))
			.where(and(
				eq(broadcastDeckLists.id, id),
				eq(broadcastDeckLists.eventId, eventId),
				eq(events.broadcastDeckListsEnabled, true),
			))
			.limit(1);
		return list !== undefined;
	};

	const create = async (
		eventId: number,
		input: Omit<CreateBroadcastDeckListInput, 'sourceText'>,
		document: BroadcastDeckListCanonicalDocument,
	): Promise<BroadcastDeckListResponse> => {
		const name = cleanBroadcastDeckListName(input.name);
		const now = Date.now();
		const operationVersion = crypto.randomUUID();
		const client = db.$client;
		try {
			const results = await client.batch([
				client.prepare(`
					INSERT INTO broadcast_deck_lists (
						event_id, name, normalized_name, source_text,
						archetype_label, colors, revision, operation_version, created_at, updated_at
					) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
				`).bind(
					eventId,
					name,
					normalizeBroadcastDeckListName(name),
					document.sourceText,
					normalizedLabel(input.archetypeLabel) ?? null,
					normalizeColors(input.colors) ?? null,
					operationVersion,
					now,
					now,
				),
				entryInsertStatement(client, null, document),
				detailSelectStatement(client, 'operation', eventId, operationVersion),
			]);
			const id = Number(results[0]?.meta.last_row_id);
			if (!Number.isSafeInteger(id) || id <= 0)
				throw new Error('Broadcast Deck List identity was not returned');
			const created = mapStoredDetail(results[2] as D1Result<StoredDetailRow>);
			if (!created)
				throw new Error('Broadcast Deck List was not stored');
			if (created.id !== id)
				throw new Error('Broadcast Deck List identity changed during storage');
			return created;
		}
		catch (error) {
			if (isListNameConflict(error))
				throw new BroadcastDeckListNameConflict();
			throw error;
		}
	};

	const update = async (
		id: number,
		eventId: number,
		input: UpdateBroadcastDeckListInput,
		document?: BroadcastDeckListCanonicalDocument,
	): Promise<BroadcastDeckListMutationResult> => {
		if ((input.sourceText !== undefined) !== (document !== undefined))
			throw new Error('Broadcast Deck List source replacement requires its resolved document');
		const setClauses: string[] = [];
		const bindings: unknown[] = [];
		if (input.name !== undefined) {
			const name = cleanBroadcastDeckListName(input.name);
			setClauses.push('name = ?', 'normalized_name = ?');
			bindings.push(name, normalizeBroadcastDeckListName(name));
		}
		if (input.archetypeLabel !== undefined) {
			setClauses.push('archetype_label = ?');
			bindings.push(normalizedLabel(input.archetypeLabel));
		}
		if (input.colors !== undefined) {
			setClauses.push('colors = ?');
			bindings.push(normalizeColors(input.colors));
		}

		const operationVersion = document ? crypto.randomUUID() : null;
		if (document) {
			setClauses.push('source_text = ?', 'operation_version = ?');
			bindings.push(document.sourceText, operationVersion);
		}
		setClauses.push('revision = revision + 1', 'updated_at = ?');
		bindings.push(Date.now());

		const client = db.$client;
		const statements = [
			client.prepare(`
				UPDATE broadcast_deck_lists
				SET ${setClauses.join(', ')}
				WHERE id = ? AND event_id = ? AND revision = ?
			`).bind(...bindings, id, eventId, input.expectedRevision),
		];
		if (document) {
			statements.push(
				client.prepare(`
					DELETE FROM broadcast_deck_list_entries
					WHERE list_id = ?
						AND EXISTS (SELECT 1 FROM broadcast_deck_lists WHERE id = ? AND operation_version = ?)
				`).bind(id, id, operationVersion),
				entryInsertStatement(client, id, document, { operationVersion: operationVersion! }),
			);
		}
		statements.push(detailSelectStatement(client, 'identity', id, eventId));

		let results;
		try {
			results = await client.batch(statements);
		}
		catch (error) {
			if (isListNameConflict(error))
				throw new BroadcastDeckListNameConflict();
			throw error;
		}

		const stored = mapStoredDetail(results.at(-1) as D1Result<StoredDetailRow>);
		if (results[0]?.meta.changes !== 1) {
			const current = stored;
			return current ? { status: 'conflict', current } : { status: 'missing' };
		}

		const updated = stored;
		if (!updated)
			throw new Error('Broadcast Deck List disappeared after update');
		return { status: 'updated', item: updated };
	};

	const remove = async (id: number, eventId: number, expectedRevision: number): Promise<BroadcastDeckListDeleteResult> => {
		const client = db.$client;
		const [snapshot, affectedResult, result] = await client.batch([
			detailSelectStatement(client, 'identity', id, eventId),
			client.prepare(`
				SELECT id, name
				FROM screens
				WHERE event_id = ?
					AND json_extract(mode_configs, '$.deck.deckSource.type') = 'broadcast'
					AND json_extract(mode_configs, '$.deck.deckSource.broadcastDeckListId') = ?
				ORDER BY name COLLATE NOCASE, id
			`).bind(eventId, id),
			client.prepare(`
				DELETE FROM broadcast_deck_lists
				WHERE id = ? AND event_id = ? AND revision = ?
					AND NOT EXISTS (
						SELECT 1 FROM screens
						WHERE screens.event_id = ?
							AND json_extract(screens.mode_configs, '$.deck.deckSource.type') = 'broadcast'
							AND json_extract(screens.mode_configs, '$.deck.deckSource.broadcastDeckListId') = ?
					)
				RETURNING id
			`).bind(id, eventId, expectedRevision, eventId, id),
		]);
		if ((result as D1Result<{ id: number }> | undefined)?.results.length === 1)
			return { status: 'deleted' };
		const current = mapStoredDetail(snapshot as D1Result<StoredDetailRow>);
		if (!current)
			return { status: 'missing' };
		const affected = (affectedResult as D1Result<BroadcastDeckListAffectedScreen>).results;
		return affected.length > 0
			? { status: 'in-use', current, screens: affected }
			: { status: 'conflict', current };
	};

	return {
		findByEventId,
		findById,
		findEventGame,
		sourceIsSelectable,
		create,
		update,
		remove,
	};
}
