import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Drizzle client over the Worker's D1 binding. The binding is looked up on
 * first use rather than at import, and a missing one fails at the use.
 */

/** Enough of a D1 binding for Drizzle to wrap; nothing here runs a query. */
function binding(): D1Database {
	return { prepare: vi.fn(), batch: vi.fn(), exec: vi.fn(), dump: vi.fn() } as unknown as D1Database;
}

async function freshModule() {
	vi.resetModules();
	return await import('~~/server/db');
}

describe('the database client', () => {
	const previousEnv = (globalThis as { __env__?: unknown }).__env__;

	beforeEach(() => {
		delete (globalThis as { __env__?: unknown }).__env__;
	});

	afterEach(() => {
		(globalThis as { __env__?: unknown }).__env__ = previousEnv;
	});

	it('imports without a binding, so a module graph can load before the Worker hands one over', async () => {
		await expect(freshModule()).resolves.toHaveProperty('db');
	});

	it('refuses at first use when the Worker has no DB binding', async () => {
		const { db } = await freshModule();

		expect(() => db.$client).toThrowError('DB binding not found');
	});

	it('wraps the Worker\'s DB binding', async () => {
		const database = binding();
		(globalThis as { __env__?: unknown }).__env__ = { DB: database };
		const { db } = await freshModule();

		expect(db.$client).toBe(database);
	});

	it('knows every table, including the auth and Graphics Asset Library schemas kept in their own files', async () => {
		(globalThis as { __env__?: unknown }).__env__ = { DB: binding() };
		const { db, schema } = await freshModule();

		expect(Object.keys(db.query)).toEqual(expect.arrayContaining(['events', 'screens', 'user', 'session', 'graphicAssets']));
		expect(schema).toHaveProperty('user');
		expect(schema).toHaveProperty('graphicAssets');
		expect(schema).toHaveProperty('events');
	});
});
