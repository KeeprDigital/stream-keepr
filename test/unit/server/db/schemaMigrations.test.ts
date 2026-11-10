import { execFile } from 'node:child_process';
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { afterAll, expect, it } from 'vitest';

const repositoryRoot = process.cwd();
const migrationsDirectory = resolve(repositoryRoot, 'server/db/migrations/sqlite');
const scratch: string[] = [];

afterAll(async () => {
	await Promise.all(scratch.map(directory => rm(directory, { recursive: true, force: true })));
});

/**
 * What `pnpm db:generate` would write, keyed by filename: it runs against a
 * copy of the migrations, under the repository's own drizzle config with only
 * `out` moved (drizzle-kit takes `out` relative to where it runs).
 */
async function pendingMigrations() {
	const directory = await mkdtemp(join(tmpdir(), 'stream-keepr-schema-'));
	scratch.push(directory);
	const out = join(directory, 'migrations');
	await cp(migrationsDirectory, out, { recursive: true });
	const config = join(directory, 'drizzle.config.ts');
	await writeFile(config, [
		`import base from ${JSON.stringify(resolve(repositoryRoot, 'drizzle.config.ts'))};`,
		`export default { ...base, out: ${JSON.stringify(relative(repositoryRoot, out))} };`,
	].join('\n'));

	const generated = promisify(execFile)(
		process.execPath,
		[
			resolve(repositoryRoot, 'node_modules/drizzle-kit/bin.cjs'),
			'generate',
			'--config',
			config,
		],
		{ cwd: repositoryRoot },
	);
	// A rename drizzle-kit cannot tell from a drop-and-add asks which; with no one to answer, it fails.
	generated.child.stdin?.end();
	await generated;

	const committed = new Set(await readdir(migrationsDirectory));
	const written = (await readdir(out)).filter(name => name.endsWith('.sql') && !committed.has(name));
	return Object.fromEntries(await Promise.all(
		written.map(async name => [name, await readFile(join(out, name), 'utf8')] as const),
	));
}

// A table, column, index, default or constraint changed in `server/db/schema*`
// without `pnpm db:generate` never reaches a deployed database.
it('the schema asks for no migration beyond those committed', async () => {
	expect(await pendingMigrations()).toEqual({});
});
