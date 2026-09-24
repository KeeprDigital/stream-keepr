import process from 'node:process';
import { drizzle } from 'drizzle-orm/d1';
import * as coreSchema from './schema';
import * as authSchema from './schema/auth';
import * as graphicsAssetSchema from './schema/graphicsAsset';

/** Every table and relation Drizzle's relational queries (`db.query.*`) can reach. */
export const schema = { ...coreSchema, ...authSchema, ...graphicsAssetSchema };

type Database = ReturnType<typeof drizzle<typeof schema>>;

let database: Database | undefined;

/**
 * The Worker's `DB` binding, looked up on first use rather than at import: Nitro
 * places it on `process.env` or `globalThis.__env__` once a request arrives, and
 * a module graph may load before that. A missing binding therefore fails where a
 * failing query would, inside the call (see `graphicsCatalogueClient`).
 */
function connect(): Database {
	if (!database) {
		const binding = (process.env as Record<string, unknown>).DB
			|| (globalThis as { __env__?: { DB?: D1Database } }).__env__?.DB;
		if (!binding)
			throw new Error('DB binding not found');
		database = drizzle(binding as D1Database, { schema });
	}
	return database;
}

/** The Drizzle client over D1. Its binding is resolved on first property access. */
export const db = new Proxy({} as Database, {
	get: (_, property) => Reflect.get(connect(), property),
});
