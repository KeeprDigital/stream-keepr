/**
 * A `D1Database`-shaped adapter over a local libSQL file database, plus the
 * repository's real Drizzle migrations.
 *
 * The Graphics Asset Library keeps its transactional reachability proofs,
 * conditional transitions, and batch atomicity in SQL, so module tests need
 * genuine SQLite semantics rather than a hand-written catalogue double. This
 * helper gives module-level tests the same statement, batch, and cascade
 * behaviour the deployed D1 catalogue relies on.
 */

import type { Client, InStatement, ResultSet } from '@libsql/client';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';

const migrationsDirectory = fileURLToPath(
	new URL('../../server/db/migrations/sqlite', import.meta.url),
);

interface PreparedStatement {
	sql: string;
	args: unknown[];
}

function toStatement(prepared: PreparedStatement): InStatement {
	return { sql: prepared.sql, args: prepared.args as InStatement['args'] };
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

function createPreparedStatement(client: Client, sql: string, args: unknown[]) {
	const statement = {
		sql,
		args,
		bind(...values: unknown[]) {
			return createPreparedStatement(client, sql, values);
		},
		async first<T>(column?: string) {
			const result = await client.execute(toStatement({ sql, args }));
			const [row] = plainRows<Record<string, unknown>>(result);
			if (!row)
				return null;
			return (column === undefined ? row : row[column]) as T;
		},
		async run<T>() {
			return d1Result<T>(await client.execute(toStatement({ sql, args })));
		},
		async all<T>() {
			return d1Result<T>(await client.execute(toStatement({ sql, args })));
		},
		async raw<T>() {
			const result = await client.execute(toStatement({ sql, args }));
			return result.rows.map(row => [...row]) as T[];
		},
	};
	return statement;
}

export interface SqliteD1Harness {
	database: D1Database;
	client: Client;
	/** Applies any migrations `throughMigration` held back, in order. */
	applyRemainingMigrations: () => Promise<void>;
	close: () => Promise<void>;
}

export interface SqliteD1HarnessOptions {
	/**
	 * Stop after this migration instead of applying every one, so a test can
	 * arrange pre-migration rows and then observe what the next migration does
	 * to them. Matches on a filename prefix such as `0014`.
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
	const directory = mkdtempSync(join(tmpdir(), 'stream-keepr-d1-'));
	const client = createClient({ url: `file:${join(directory, 'catalogue.sqlite')}` });
	await client.execute('PRAGMA foreign_keys = ON');
	// Cascade and RESTRICT behaviour is load-bearing for the reachability and
	// race proofs these tests make, so never let them run without it.
	const [foreignKeys] = (await client.execute('PRAGMA foreign_keys')).rows;
	if (Number(foreignKeys?.foreign_keys) !== 1)
		throw new Error('SQLite foreign key enforcement could not be enabled');

	const migrations = readdirSync(migrationsDirectory)
		.filter(entry => entry.endsWith('.sql'))
		.toSorted();
	const heldBackFrom = options.throughMigration === undefined
		? migrations.length
		: migrations.findIndex(migration => migration.startsWith(options.throughMigration!)) + 1;
	if (heldBackFrom === 0)
		throw new Error(`No migration matches ${options.throughMigration}`);

	async function applyMigrations(entries: readonly string[]) {
		for (const migration of entries) {
			const contents = readFileSync(join(migrationsDirectory, migration), 'utf8');
			for (const statement of contents.split('--> statement-breakpoint')) {
				const trimmed = statement.trim().replace(/;$/, '');
				if (trimmed)
					await client.execute(trimmed);
			}
		}
	}

	await applyMigrations(migrations.slice(0, heldBackFrom));

	const database = {
		prepare(sql: string) {
			return createPreparedStatement(client, sql, []);
		},
		async batch<T>(statements: ReturnType<typeof createPreparedStatement>[]) {
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
		async applyRemainingMigrations() {
			await applyMigrations(migrations.slice(heldBackFrom));
		},
		async close() {
			client.close();
			rmSync(directory, { recursive: true, force: true });
		},
	};
}
