import type { BroadcastDeckListAggregate, BroadcastDeckListSummaryRow } from '~~/server/mappers/broadcastDeckList';
import type { BroadcastDeckListCanonicalDocument } from '~~/server/modules/broadcast-deck-list-import';
import type { BroadcastDeckListResponse, BroadcastDeckListSummaryResponse, CreateBroadcastDeckListInput, UpdateBroadcastDeckListInput } from '~~/shared/types/broadcastDeckList';
import { and, asc, eq, getTableColumns, sql } from 'drizzle-orm';
import { db } from 'hub:db';
import { broadcastDeckListEntries, broadcastDeckLists, events } from '~~/server/db/schema';
import { mapBroadcastDeckListDetail, mapBroadcastDeckListSummary } from '~~/server/mappers/broadcastDeckList';

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
		| { status: 'missing' };

const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G'] as const;

export function cleanBroadcastDeckListName(name: string): string {
	return name.trim().replace(/\s+/g, ' ');
}

export function normalizeBroadcastDeckListName(name: string): string {
	return cleanBroadcastDeckListName(name).normalize('NFKC').toLocaleLowerCase('en-US');
}

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
		const [list] = await db
			.select()
			.from(broadcastDeckLists)
			.where(and(eq(broadcastDeckLists.id, id), eq(broadcastDeckLists.eventId, eventId)))
			.limit(1);
		if (!list)
			return undefined;

		const entries = await db
			.select()
			.from(broadcastDeckListEntries)
			.where(eq(broadcastDeckListEntries.listId, id))
			.orderBy(
				sql`case ${broadcastDeckListEntries.compartment} when 'mainboard' then 0 when 'sideboard' then 1 else 2 end`,
				asc(broadcastDeckListEntries.sortOrder),
				asc(broadcastDeckListEntries.id),
			);
		return { ...list, entries };
	};

	const findById = async (id: number, eventId: number): Promise<BroadcastDeckListResponse | undefined> => {
		const list = await findAggregateById(id, eventId);
		return list ? mapBroadcastDeckListDetail(list) : undefined;
	};

	const findEventGame = async (eventId: number): Promise<'mtg' | 'op' | undefined> => {
		const [event] = await db.select({ game: events.game }).from(events).where(eq(events.id, eventId)).limit(1);
		return event?.game;
	};

	const create = async (
		eventId: number,
		input: Omit<CreateBroadcastDeckListInput, 'sourceText'>,
		document: BroadcastDeckListCanonicalDocument,
	): Promise<BroadcastDeckListResponse> => {
		const name = cleanBroadcastDeckListName(input.name);
		const now = Date.now();
		const client = db.$client;
		try {
			const results = await client.batch([
				client.prepare(`
					INSERT INTO broadcast_deck_lists (
						event_id, name, normalized_name, source_text,
						archetype_label, colors, revision, created_at, updated_at
					) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
				`).bind(
					eventId,
					name,
					normalizeBroadcastDeckListName(name),
					document.sourceText,
					normalizedLabel(input.archetypeLabel) ?? null,
					normalizeColors(input.colors) ?? null,
					now,
					now,
				),
				entryInsertStatement(client, null, document),
			]);
			const id = Number(results[0]?.meta.last_row_id);
			if (!Number.isSafeInteger(id) || id <= 0)
				throw new Error('Broadcast Deck List identity was not returned');
			const created = await findById(id, eventId);
			if (!created)
				throw new Error('Broadcast Deck List was not stored');
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

		let results;
		try {
			results = await client.batch(statements);
		}
		catch (error) {
			if (isListNameConflict(error))
				throw new BroadcastDeckListNameConflict();
			throw error;
		}

		if (results[0]?.meta.changes !== 1) {
			const current = await findById(id, eventId);
			return current ? { status: 'conflict', current } : { status: 'missing' };
		}

		const updated = await findById(id, eventId);
		if (!updated)
			throw new Error('Broadcast Deck List disappeared after update');
		return { status: 'updated', item: updated };
	};

	const remove = async (id: number, eventId: number, expectedRevision: number): Promise<BroadcastDeckListDeleteResult> => {
		const result = await db.$client.prepare(`
			DELETE FROM broadcast_deck_lists
			WHERE id = ? AND event_id = ? AND revision = ?
		`).bind(id, eventId, expectedRevision).run();
		if (result.meta.changes === 1)
			return { status: 'deleted' };
		const current = await findById(id, eventId);
		return current ? { status: 'conflict', current } : { status: 'missing' };
	};

	return {
		findByEventId,
		findById,
		findEventGame,
		create,
		update,
		remove,
	};
}
