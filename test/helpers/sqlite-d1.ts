/**
 * A `D1Database`-shaped adapter over a local libSQL file database, plus the
 * repository's real Drizzle migrations.
 *
 * Anything whose correctness is in the SQL needs genuine SQLite semantics rather than
 * a hand-written double: the Graphics Asset Library's transactional reachability
 * proofs, conditional transitions and batch atomicity, and the Broadcast Graphics
 * Live Session's reference-index sequence guard. This helper gives them the same
 * statement, batch, and cascade behaviour the deployed D1 catalogue relies on.
 *
 * It is not scoped to any one module or suite. Module tests under the unit suite
 * consume it, and so does a Nuxt **store** test that drives a real server half — which
 * is also why the migration directory is resolved defensively below: only one of the
 * two environments gives this module a `file:` URL.
 *
 * `raw()` is the one part of it no consumer can check for itself, and it is pinned by
 * `test/unit/helpers/sqliteD1Harness.test.ts` — which records, for each mutation it was
 * written against, whether the pin detects it (#211). That is a record of the mutations
 * considered, not a claim that no other mutation escapes.
 *
 * What it is *not* is a substitute for D1 itself. Two known differences are handled
 * elsewhere rather than here: D1's hundred-bound-parameter ceiling, which libSQL
 * does not enforce and `miniflare-d1.ts` exists to test against, and anything about
 * D1's storage or replication. `raw()` below is the seam where the two are most
 * easily confused, and it carries its own note.
 */

import type { Client, InStatement, ResultSet } from '@libsql/client';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';

/**
 * Resolved from this file where that is possible, and from the repository root
 * where it is not: Vitest's Nuxt environment does not give this module a `file:`
 * URL, and every Vitest run has the repository root as its working directory.
 */
function resolveMigrationsDirectory(): string {
	try {
		return fileURLToPath(new URL('../../server/db/migrations/sqlite', import.meta.url));
	}
	catch (failure) {
		// Only the one condition this fallback exists for. Anything else here is a
		// real breakage, and swallowing it into a path guess would turn a broken
		// harness into a confusing "no migrations found" much further along.
		if ((failure as NodeJS.ErrnoException)?.code !== 'ERR_INVALID_URL_SCHEME')
			throw failure;
		return resolve(process.cwd(), 'server/db/migrations/sqlite');
	}
}

const migrationsDirectory = resolveMigrationsDirectory();

interface PreparedStatement {
	sql: string;
	args: unknown[];
}

/**
 * Cast whole rather than by field: `@libsql/client` resolves to a different entry
 * point under the app project's conditions than under the server's, and only one of
 * the two `InStatement` unions has an indexable `args`.
 */
function toStatement(prepared: PreparedStatement): InStatement {
	return { sql: prepared.sql, args: prepared.args } as InStatement;
}

function plainRows<T>(result: ResultSet): T[] {
	return result.rows.map((row) => {
		const plain: Record<string, unknown> = {};
		for (const column of result.columns)
			plain[column] = row[column] ?? null;
		return plain as T;
	});
}

function d1Result<T>(result: ResultSet) {
	return {
		success: true as const,
		results: plainRows<T>(result),
		meta: {
			duration: 0,
			size_after: 0,
			rows_read: result.rows.length,
			rows_written: result.rowsAffected,
			last_row_id: Number(result.lastInsertRowid ?? 0),
			changed_db: result.rowsAffected > 0,
			changes: result.rowsAffected,
		},
	};
}

/** Counts the round trips a database makes: one per statement run alone, one per batch. */
interface RoundTripCounter {
	count: number;
}

function createPreparedStatement(source: Client, counter: RoundTripCounter, sql: string, args: unknown[]) {
	const client = {
		execute(statement: InStatement) {
			counter.count++;
			return source.execute(statement);
		},
	};
	const statement = {
		sql,
		args,
		bind(...values: unknown[]) {
			return createPreparedStatement(source, counter, sql, values);
		},
		async first<T>(column?: string) {
			const result = await client.execute(toStatement({ sql, args }));
			const [row] = plainRows<Record<string, unknown>>(result);
			if (!row)
				return null;
			return (column === undefined
				? row
				: row[column]) as T;
		},
		async run<T>() {
			return d1Result<T>(await client.execute(toStatement({ sql, args })));
		},
		async all<T>() {
			return d1Result<T>(await client.execute(toStatement({ sql, args })));
		},
		async raw<T>() {
			const result = await client.execute(toStatement({ sql, args }));
			// By position, which is what D1's own `raw` answers and what Drizzle's D1
			// driver reads — it routes every `select()` and `.returning()` through here.
			// A libSQL row is not iterable, so it cannot simply be spread; it exposes a
			// numeric index for every column but registers a *name* only for the first
			// column bearing it. Rebuilding by name therefore collapses `a.id, b.id` to
			// the left table's value on both — silently, and on most joins in this
			// schema, since `id`, `created_at` and `updated_at` are near-universal.
			return result.rows.map(
				row => Array.from({ length: result.columns.length }, (_, index) => row[index] ?? null),
			) as T[];
		},
	};
	return statement;
}

export interface SqliteD1Harness {
	database: D1Database;
	client: Client;
	/**
	 * How many round trips `database` has made: one per statement run alone and
	 * one per batch, as D1 bills them. Staging through `client` is not counted.
	 */
	roundTrips: () => number;
	/** Applies any migrations `throughMigration` held back, in order. */
	applyRemainingMigrations: () => Promise<void>;
	close: () => Promise<void>;
}

export interface SqliteD1HarnessOptions {
	/**
	 * Stop after this migration instead of applying every one, so a test can
	 * arrange pre-migration rows and then observe what the next migration does
	 * to them. Matches on a filename prefix such as `0000`.
	 */
	throughMigration?: string;
}

/**
 * Creates an isolated SQLite database with every repository migration applied.
 * Foreign keys are enabled so `ON DELETE CASCADE` and `RESTRICT` behave as they
 * do in D1.
 */
export async function createSqliteD1Harness(
	options: SqliteD1HarnessOptions = {},
): Promise<SqliteD1Harness> {
	const migrations = readdirSync(migrationsDirectory)
		.filter(entry => entry.endsWith('.sql'))
		.toSorted();
	const heldBackFrom = options.throughMigration === undefined
		? migrations.length
		: migrations.findIndex(migration => migration.startsWith(options.throughMigration!)) + 1;
	if (heldBackFrom === 0)
		throw new Error(`No migration matches ${options.throughMigration}`);

	const directory = mkdtempSync(join(tmpdir(), 'stream-keepr-d1-'));
	const file = join(directory, 'catalogue.sqlite');
	copyFileSync(await migratedTemplate(migrations.slice(0, heldBackFrom)), file);
	const client = await openWithForeignKeys(file);

	return harnessOver(client, directory, () => applyMigrations(client, migrations.slice(heldBackFrom)));
}

async function openWithForeignKeys(file: string): Promise<Client> {
	const client = createClient({ url: `file:${file}` });
	await client.execute('PRAGMA foreign_keys = ON');
	// Cascade and RESTRICT behaviour is load-bearing for the reachability and
	// race proofs these tests make, so never let them run without it.
	const [foreignKeys] = (await client.execute('PRAGMA foreign_keys')).rows;
	if (Number(foreignKeys?.foreign_keys) !== 1)
		throw new Error('SQLite foreign key enforcement could not be enabled');
	return client;
}

async function applyMigrations(client: Client, entries: readonly string[]) {
	for (const migration of entries) {
		const contents = readFileSync(join(migrationsDirectory, migration), 'utf8');
		for (const statement of contents.split('--> statement-breakpoint')) {
			const trimmed = statement.trim().replace(/;$/, '');
			if (trimmed)
				await client.execute(trimmed);
		}
	}
}

/** Bump when how a template is built changes, so no checkout reuses one built the old way. */
const TEMPLATE_BUILD = 1;
const templateDirectory = resolve(process.cwd(), 'node_modules/.cache/sqlite-d1-templates');
const templates = new Map<string, Promise<string>>();

/**
 * A database file with `entries` applied, to copy rather than build: replaying
 * every migration statement cost each harness about a tenth of a second, and
 * most tests make one. Named by the migrations' own bytes, so an edited or new
 * migration is a different template, and kept across runs. Built beside its
 * final name and renamed into place, so two processes building the same
 * template at once each leave a whole file.
 */
function migratedTemplate(entries: readonly string[]): Promise<string> {
	const hash = createHash('sha256').update(`build ${TEMPLATE_BUILD}\n`);
	for (const migration of entries)
		hash.update(migration).update('\0').update(readFileSync(join(migrationsDirectory, migration))).update('\0');
	const template = join(templateDirectory, `${hash.digest('hex').slice(0, 32)}.sqlite`);

	let ready = templates.get(template);
	if (!ready) {
		ready = existsSync(template)
			? Promise.resolve(template)
			: buildTemplate(template, entries);
		templates.set(template, ready);
	}
	return ready;
}

async function buildTemplate(template: string, entries: readonly string[]): Promise<string> {
	mkdirSync(templateDirectory, { recursive: true });
	const building = mkdtempSync(join(templateDirectory, 'building-'));
	try {
		const file = join(building, 'template.sqlite');
		const client = await openWithForeignKeys(file);
		await applyMigrations(client, entries);
		client.close();
		renameSync(file, template);
	}
	finally {
		rmSync(building, { recursive: true, force: true });
	}
	return template;
}

function harnessOver(client: Client, directory: string, applyRemainingMigrations: () => Promise<void>): SqliteD1Harness {
	const counter: RoundTripCounter = { count: 0 };
	const database = {
		prepare(sql: string) {
			return createPreparedStatement(client, counter, sql, []);
		},
		async batch<T>(statements: ReturnType<typeof createPreparedStatement>[]) {
			counter.count++;
			const results = await client.batch(statements.map(toStatement), 'write');
			return results.map(result => d1Result<T>(result));
		},
		async exec(sql: string) {
			const statements = sql.split(';').map(entry => entry.trim()).filter(Boolean);
			for (const statement of statements)
				await client.execute(statement);
			return { count: statements.length, duration: 0 };
		},
	} as unknown as D1Database;

	return {
		database,
		client,
		roundTrips: () => counter.count,
		applyRemainingMigrations,
		async close() {
			client.close();
			rmSync(directory, { recursive: true, force: true });
		},
	};
}
