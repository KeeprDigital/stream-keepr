/**
 * A real Cloudflare D1 binding, backed by Miniflare through Wrangler's platform
 * proxy, with the repository's real migrations applied.
 *
 * The libSQL database the other module tests run against accepts several
 * hundred bound parameters per query. D1 accepts one hundred, and fails the
 * whole statement on the hundred-and-first with `too many SQL variables`. That
 * gap means a query can pass every module test and still fail on its first
 * production run, so the queries whose parameter count grows with the data need
 * a database that enforces the real limit.
 *
 * This is deliberately not a general replacement for the libSQL harness: it
 * starts a Workers runtime, so it is reserved for the behaviour only a real D1
 * can prove.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPlatformProxy } from 'wrangler';

const migrationsDirectory = fileURLToPath(
	new URL('../../server/db/migrations/sqlite', import.meta.url),
);
const wranglerConfigPath = fileURLToPath(
	new URL('../../wrangler.jsonc', import.meta.url),
);

/**
 * The deployed runtime's compatibility date, read from the real config so this
 * harness cannot drift into testing a different runtime than production runs.
 * NuxtHub injects the D1 binding itself at build time, so the binding is
 * declared here rather than read from that config.
 */
function deployedCompatibility() {
	const config = JSON.parse(
		readFileSync(wranglerConfigPath, 'utf8').replace(/^\s*\/\/.*$/gm, ''),
	) as { compatibility_date: string; compatibility_flags?: string[] };
	return {
		compatibility_date: config.compatibility_date,
		compatibility_flags: config.compatibility_flags ?? [],
	};
}

export interface MiniflareD1Harness {
	database: D1Database;
	dispose: () => Promise<void>;
}

export async function createMiniflareD1Harness(): Promise<MiniflareD1Harness> {
	const directory = mkdtempSync(join(tmpdir(), 'stream-keepr-miniflare-d1-'));
	const configPath = join(directory, 'wrangler.json');
	writeFileSync(configPath, JSON.stringify({
		name: 'stream-keepr-d1-limits',
		...deployedCompatibility(),
		d1_databases: [{ binding: 'DB', database_name: 'limits', database_id: 'limits' }],
	}));

	const proxy = await getPlatformProxy<{ DB: D1Database }>({
		configPath,
		persist: false,
	});
	const database = proxy.env.DB;

	for (const migration of readdirSync(migrationsDirectory)
		.filter(entry => entry.endsWith('.sql'))
		.toSorted()) {
		const contents = readFileSync(join(migrationsDirectory, migration), 'utf8');
		for (const statement of contents.split('--> statement-breakpoint')) {
			const trimmed = statement.trim().replace(/;$/, '');
			if (trimmed)
				await database.prepare(trimmed).run();
		}
	}

	return {
		database,
		dispose: async () => {
			await proxy.dispose();
			rmSync(directory, { recursive: true, force: true });
		},
	};
}
