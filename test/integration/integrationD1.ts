import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { afterAll } from 'vitest';
import { getPlatformProxy, unstable_splitSqlQuery } from 'wrangler';
import { resolveIntegrationWranglerPersistDir } from './state';

const wranglerConfig = resolve(process.cwd(), 'wrangler.dev.jsonc');
const migrationDirectory = resolve(process.cwd(), 'server/db/migrations/sqlite');
const createMigrationsTableSql = `CREATE TABLE IF NOT EXISTS _hub_migrations (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT UNIQUE,
	applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
)`;

interface IntegrationBindings {
	DB: D1Database;
}

function openIntegrationD1(persistDir = resolveIntegrationWranglerPersistDir()) {
	// Use the same config conversion as Nitro's Cloudflare development proxy.
	// The Wrangler migration CLI resolves binding-only databases by binding name,
	// while getPlatformProxy resolves them by database_name; using the proxy here
	// guarantees setup and the Nuxt server address the exact same local D1 object.
	return getPlatformProxy<IntegrationBindings>({
		configPath: wranglerConfig,
		envFiles: [],
		persist: { path: persistDir },
		remoteBindings: false,
	});
}

async function useIntegrationD1<T>(
	callback: (database: D1Database) => Promise<T>,
	persistDir?: string,
) {
	const proxy = await openIntegrationD1(persistDir);

	try {
		return await callback(proxy.env.DB);
	}
	finally {
		await proxy.dispose();
	}
}

/**
 * One proxy for a whole test file, opened by its first fixture statement and
 * closed after its last test.
 *
 * Each proxy is a second Workers runtime on the persist directory the file's
 * server holds open, and booting one costs more than the statement it carries:
 * a file that moves a Session through time opened and closed ten of them. The
 * hook is registered while the file is collected, which is the only time a
 * file-level hook can be; where there is no file to close it after
 * (`globalSetup` imports this module for `prepareIntegrationD1`), each call
 * keeps opening and closing its own.
 */
let fileProxy: ReturnType<typeof openIntegrationD1> | undefined;
let closedAfterFile = false;

if (process.env.VITEST_WORKER_ID !== undefined || process.env.VITEST_POOL_ID !== undefined) {
	afterAll(async () => {
		const opened = fileProxy;
		fileProxy = undefined;
		await (await opened?.catch(() => undefined))?.dispose();
	});
	closedAfterFile = true;
}

async function withFileDatabase<T>(callback: (database: D1Database) => Promise<T>): Promise<T> {
	if (!closedAfterFile)
		return await useIntegrationD1(callback);

	fileProxy ??= openIntegrationD1();
	const opening = fileProxy;
	let proxy: Awaited<typeof opening>;
	try {
		proxy = await opening;
	}
	catch (error) {
		// A proxy that failed to start is not kept: the next statement opens another.
		if (fileProxy === opening)
			fileProxy = undefined;
		throw error;
	}
	return await callback(proxy.env.DB);
}

async function getMigrationFiles() {
	return (await readdir(migrationDirectory))
		.filter(name => /^\d{4}_.+\.sql$/.test(name))
		.toSorted();
}

/**
 * Apply every checked-in migration before the Nuxt test server can open D1, then
 * start its Event ids at `firstEventId` (see `integrationEventIdBlocks`).
 */
export async function prepareIntegrationD1(persistDir?: string, { firstEventId }: { firstEventId?: number } = {}) {
	const expectedMigrations = await getMigrationFiles();
	if (expectedMigrations.length === 0)
		throw new Error('Integration D1 migration chain is empty');

	await useIntegrationD1(async (database) => {
		await database.prepare(createMigrationsTableSql).run();
		const existing = await database
			.prepare('SELECT name FROM _hub_migrations ORDER BY id')
			.all<{ name: string }>();
		const appliedMigrations = new Set(existing.results.map(row => row.name));

		for (const filename of expectedMigrations) {
			const migrationName = filename.replace(/\.sql$/, '');
			if (appliedMigrations.has(migrationName))
				continue;

			const sql = await readFile(resolve(migrationDirectory, filename), 'utf8');
			const statements = unstable_splitSqlQuery(sql)
				.filter(statement => statement.trim().length > 0)
				.map(statement => database.prepare(statement));
			statements.push(
				database.prepare('INSERT INTO _hub_migrations (name) VALUES (?)').bind(migrationName),
			);
			await database.batch(statements);
		}

		const final = await database
			.prepare('SELECT name FROM _hub_migrations ORDER BY id')
			.all<{ name: string }>();
		const finalAppliedMigrations = new Set(final.results.map(row => row.name));
		const missingMigrations = expectedMigrations
			.map(filename => filename.replace(/\.sql$/, ''))
			.filter(name => !finalAppliedMigrations.has(name));

		if (missingMigrations.length > 0) {
			throw new Error(`Integration D1 migration chain is incomplete; missing: ${missingMigrations.join(', ')}`);
		}

		if (firstEventId !== undefined) {
			await database.batch([
				database.prepare('DELETE FROM sqlite_sequence WHERE name = \'events\''),
				database.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (\'events\', MAX(?, (SELECT COALESCE(MAX(id), 0) FROM events)))')
					.bind(firstEventId - 1),
			]);
		}
	}, persistDir === undefined
		? undefined
		: resolveIntegrationWranglerPersistDir(process.cwd(), persistDir));
}

/** Execute controlled fixture SQL against the isolated integration database. */
export async function executeIntegrationD1(command: string) {
	await withFileDatabase(async (database) => {
		const statements = unstable_splitSqlQuery(command)
			.filter(statement => statement.trim().length > 0)
			.map(statement => database.prepare(statement));
		await database.batch(statements);
	});
}

/** Read controlled acceptance evidence from the isolated integration database. */
export async function queryIntegrationD1<T>(
	query: string,
	bindings: readonly (string | number | null)[] = [],
): Promise<T[]> {
	return await withFileDatabase(async (database) => {
		const statement = database.prepare(query).bind(...bindings);
		return (await statement.all<T>()).results;
	});
}
