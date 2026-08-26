import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
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

async function useIntegrationD1<T>(callback: (database: D1Database) => Promise<T>) {
	// Use the same config conversion as Nitro's Cloudflare development proxy.
	// The Wrangler migration CLI resolves binding-only databases by binding name,
	// while getPlatformProxy resolves them by database_name; using the proxy here
	// guarantees setup and the Nuxt server address the exact same local D1 object.
	const proxy = await getPlatformProxy<IntegrationBindings>({
		configPath: wranglerConfig,
		envFiles: [],
		persist: { path: resolveIntegrationWranglerPersistDir() },
		remoteBindings: false,
	});

	try {
		return await callback(proxy.env.DB);
	}
	finally {
		await proxy.dispose();
	}
}

async function getMigrationFiles() {
	return (await readdir(migrationDirectory))
		.filter(name => /^\d{4}_.+\.sql$/.test(name))
		.toSorted();
}

/** Apply every checked-in migration before the Nuxt test server can open D1. */
export async function prepareIntegrationD1() {
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
	});
}

/** Execute controlled fixture SQL against the isolated integration database. */
export async function executeIntegrationD1(command: string) {
	await useIntegrationD1(async (database) => {
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
	return await useIntegrationD1(async (database) => {
		const statement = database.prepare(query).bind(...bindings);
		return (await statement.all<T>()).results;
	});
}
