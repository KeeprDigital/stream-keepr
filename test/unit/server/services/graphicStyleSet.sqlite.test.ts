import type { InArgs } from '@libsql/client';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { GraphicStyleSetEntry } from '~~/shared/types/graphicStyleSet';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';

/**
 * The two library-wide Graphic Style Set operations, against real SQL.
 *
 * The rule under test is the one the glossary states and no route can force: deleting
 * an entry or a whole Style Set "occurs only if every affected template update
 * succeeds". Both routes read the templates themselves immediately before writing, so
 * the failing half of that rule — one template revised by another session in between —
 * is only reachable here, by handing the service a rewrite at a revision the template
 * is no longer at.
 *
 * It has to be real SQL rather than an asserted statement list, because what is being
 * proved is a property of the database's behaviour: a conditional `UPDATE` that
 * matches no row is not an error and does not roll a batch back, so an operation whose
 * statements each carried their own precondition would commit the ones that matched.
 * The assertions are therefore all "this row is exactly as it was".
 */

const client = createClient({ url: 'file::memory:' });
const sqliteDb = drizzle(client, { schema });

/**
 * A D1-shaped façade over the libsql client.
 *
 * The service writes through `db.$client` in D1's own `prepare().bind()` / `batch()`
 * vocabulary, because the atomicity it needs is a property of a D1 batch. libsql
 * offers the same transaction, so the façade is a rename: one `batch(…, 'write')` and
 * `rowsAffected` read back as `meta.changes`.
 */
const d1Client = {
	prepare(sql: string) {
		return {
			sql,
			args: [] as unknown[],
			bind(...args: unknown[]) {
				return { sql, args };
			},
		};
	},
	async batch(statements: readonly { sql: string; args: unknown[] }[]) {
		const results = await client.batch(
			statements.map(statement => ({ sql: statement.sql, args: statement.args as InArgs })),
			'write',
		);
		return results.map(result => ({ meta: { changes: result.rowsAffected } }));
	},
};

Reflect.set(sqliteDb, '$client', d1Client);
vi.doMock('hub:db', () => ({ db: sqliteDb }));

const { graphicStyleSetService, GraphicStyleSetRevisionConflict } = await import('~~/server/services/graphicStyleSet');

const STYLE_SET_ID = 'show-style';
const TEMPLATE_ID = 'lower-third';
/** The revision the template really is at, and the one an operation reads it at. */
const TEMPLATE_REVISION = 3;

function entries(): GraphicStyleSetEntry[] {
	return [
		{ id: 'ink', kind: 'palette', name: 'Ink', schemaVersion: 1, value: { color: '#101014' } },
		{ id: 'brand', kind: 'palette', name: 'Brand', schemaVersion: 1, value: { color: '#ff0044' } },
	];
}

/** The linked template's document: one whole-graphic animation inherited from `brand`. */
function linkedDocument(): BroadcastGraphicConfig {
	return {
		id: TEMPLATE_ID,
		name: 'Lower third',
		items: [],
		styleSet: { styleSetId: STYLE_SET_ID, revision: 1 },
		styleRefs: { 'animation.enter': { entryId: 'brand' } },
	};
}

/** What deleting the `brand` entry leaves: the reference gone, the link kept. */
function entryDetachedDocument(): BroadcastGraphicConfig {
	return {
		id: TEMPLATE_ID,
		name: 'Lower third',
		items: [],
		styleSet: { styleSetId: STYLE_SET_ID, revision: 1 },
	};
}

/** What deleting the whole Style Set leaves: no reference and no provenance. */
function detachedDocument(): BroadcastGraphicConfig {
	return { id: TEMPLATE_ID, name: 'Lower third', items: [] };
}

async function styleSetRow() {
	const result = await client.execute({
		sql: 'select * from graphic_style_sets where id = ?',
		args: [STYLE_SET_ID],
	});
	return result.rows[0];
}

async function templateRow() {
	const result = await client.execute({
		sql: 'select * from broadcast_graphic_templates where id = ?',
		args: [TEMPLATE_ID],
	});
	return result.rows[0]!;
}

describe('graphicStyleSetService library-wide operations', () => {
	beforeEach(async () => {
		for (const statement of [
			'drop table if exists graphic_style_sets',
			'drop table if exists broadcast_graphic_templates',
			`create table graphic_style_sets (
				id text primary key not null, name text not null, description text,
				revision integer default 0 not null, draft_revision integer default 1 not null,
				draft text not null, published text, published_at integer, operation_version text,
				created_at integer not null default (unixepoch() * 1000),
				updated_at integer not null default (unixepoch() * 1000)
			)`,
			`create table broadcast_graphic_templates (
				id text primary key not null, name text not null, description text,
				revision integer default 1 not null, document text not null,
				graphic_asset_reference_version text, style_set_id text, style_set_revision integer,
				created_at integer not null default (unixepoch() * 1000),
				updated_at integer not null default (unixepoch() * 1000)
			)`,
		]) {
			await client.execute(statement);
		}

		await client.execute({
			sql: `insert into graphic_style_sets (id, name, description, revision, draft_revision, draft, published, published_at)
				values (?, ?, null, 1, 2, ?, ?, 1000)`,
			args: [STYLE_SET_ID, 'Show style', JSON.stringify(entries()), JSON.stringify(entries())],
		});
		await client.execute({
			sql: `insert into broadcast_graphic_templates (id, name, revision, document, style_set_id, style_set_revision)
				values (?, ?, ?, ?, ?, 1)`,
			args: [TEMPLATE_ID, 'Lower third', TEMPLATE_REVISION, JSON.stringify(linkedDocument()), STYLE_SET_ID],
		});
	});

	afterAll(async () => await client.close());

	it('deletes an entry and rewrites the template it reaches as one operation', async () => {
		const updated = await graphicStyleSetService().deleteEntry(STYLE_SET_ID, {
			draftRevision: 2,
			draft: entries().filter(entry => entry.id !== 'brand'),
			published: entries().filter(entry => entry.id !== 'brand'),
			rewrites: [{ id: TEMPLATE_ID, revision: TEMPLATE_REVISION, document: entryDetachedDocument() }],
		});

		expect(updated?.draft.map(entry => entry.id)).toEqual(['ink']);
		expect(updated?.published?.map(entry => entry.id)).toEqual(['ink']);
		expect(updated?.draftRevision).toBe(3);
		// Removing an entry from the published set changes what the published Style Set
		// contains, so it is a new published revision.
		expect(updated?.revision).toBe(2);

		const template = await templateRow();
		expect(template.revision).toBe(TEMPLATE_REVISION + 1);
		// The template keeps its link: only the deleted entry's reference went.
		expect(template.style_set_id).toBe(STYLE_SET_ID);
		expect(JSON.parse(String(template.document))).toEqual(entryDetachedDocument());
	});

	it('writes nothing when a template the entry deletion would rewrite has moved on', async () => {
		await expect(graphicStyleSetService().deleteEntry(STYLE_SET_ID, {
			draftRevision: 2,
			draft: entries().filter(entry => entry.id !== 'brand'),
			published: entries().filter(entry => entry.id !== 'brand'),
			// Read at a revision another session has since moved past.
			rewrites: [{ id: TEMPLATE_ID, revision: TEMPLATE_REVISION - 1, document: entryDetachedDocument() }],
		})).rejects.toThrow(GraphicStyleSetRevisionConflict);

		const styleSet = await styleSetRow();
		expect(styleSet?.draft_revision).toBe(2);
		expect(styleSet?.revision).toBe(1);
		expect(JSON.parse(String(styleSet?.draft)).map((entry: GraphicStyleSetEntry) => entry.id))
			.toEqual(['ink', 'brand']);
		expect(JSON.parse(String(styleSet?.published)).map((entry: GraphicStyleSetEntry) => entry.id))
			.toEqual(['ink', 'brand']);

		const template = await templateRow();
		expect(template.revision).toBe(TEMPLATE_REVISION);
		expect(JSON.parse(String(template.document))).toEqual(linkedDocument());
	});

	it('deletes a Style Set and detaches its templates as one operation', async () => {
		const removed = await graphicStyleSetService().remove(STYLE_SET_ID, {
			draftRevision: 2,
			rewrites: [{ id: TEMPLATE_ID, revision: TEMPLATE_REVISION, document: detachedDocument() }],
		});

		expect(removed).toBe(true);
		expect(await styleSetRow()).toBeUndefined();

		const template = await templateRow();
		expect(template.revision).toBe(TEMPLATE_REVISION + 1);
		expect(template.style_set_id).toBeNull();
		expect(template.style_set_revision).toBeNull();
	});

	/**
	 * The corruption this whole technique exists to prevent: a Style Set deleted while
	 * one template still carries references to its entries. That template's references
	 * would resolve against nothing, and every later save of it would be refused.
	 */
	it('keeps the Style Set when a template it would detach has moved on', async () => {
		const removed = await graphicStyleSetService().remove(STYLE_SET_ID, {
			draftRevision: 2,
			rewrites: [{ id: TEMPLATE_ID, revision: TEMPLATE_REVISION - 1, document: detachedDocument() }],
		});

		expect(removed).toBe(false);

		const styleSet = await styleSetRow();
		expect(styleSet?.id).toBe(STYLE_SET_ID);
		expect(styleSet?.draft_revision).toBe(2);

		const template = await templateRow();
		expect(template.revision).toBe(TEMPLATE_REVISION);
		expect(template.style_set_id).toBe(STYLE_SET_ID);
		expect(JSON.parse(String(template.document))).toEqual(linkedDocument());
	});

	it('refuses either operation when the Style Set draft itself has moved on', async () => {
		await expect(graphicStyleSetService().deleteEntry(STYLE_SET_ID, {
			draftRevision: 1,
			draft: entries().filter(entry => entry.id !== 'brand'),
			published: entries().filter(entry => entry.id !== 'brand'),
			rewrites: [{ id: TEMPLATE_ID, revision: TEMPLATE_REVISION, document: entryDetachedDocument() }],
		})).rejects.toThrow(GraphicStyleSetRevisionConflict);

		expect(await graphicStyleSetService().remove(STYLE_SET_ID, {
			draftRevision: 1,
			rewrites: [{ id: TEMPLATE_ID, revision: TEMPLATE_REVISION, document: detachedDocument() }],
		})).toBe(false);

		expect((await styleSetRow())?.draft_revision).toBe(2);
		expect((await templateRow()).revision).toBe(TEMPLATE_REVISION);
	});
});
