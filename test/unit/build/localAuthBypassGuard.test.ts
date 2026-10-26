import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOCAL_AUTH_BYPASS_ENABLED_VALUE, LOCAL_AUTH_BYPASS_NAME } from '~~/shared/utils/localDeveloperAuth';

// AGENTS.md § Local auth bypass: the name is written only in the `package.json`
// `:bypass` launchers. A deployed installation carrying it serves the app
// unauthenticated, so the files that configure a deploy, CI or `.env` never name it.

const repositoryRoot = join(import.meta.dirname, '../../..');

function read(path: string) {
	return readFileSync(join(repositoryRoot, path), 'utf8');
}

const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;

const forbiddenFiles = [
	'.env.example',
	'wrangler.jsonc',
	'wrangler.dev.jsonc',
	'workers/silent-video-validator/wrangler.jsonc',
	...readdirSync(join(repositoryRoot, '.github/workflows')).map(name => `.github/workflows/${name}`),
];

describe('the local auth bypass', () => {
	it('is armed only by the :bypass launchers, each its unbypassed twin plus the assignment', () => {
		const assignment = `${LOCAL_AUTH_BYPASS_NAME}=${LOCAL_AUTH_BYPASS_ENABLED_VALUE}`;
		const launchers = Object.keys(scripts).filter(name => name.endsWith(':bypass'));

		expect(launchers.toSorted()).toEqual(['dev:bypass', 'dev:local:bypass', 'preview:bypass']);
		for (const name of launchers)
			expect(scripts[name], name).toBe(`${assignment} pnpm ${name.slice(0, -':bypass'.length)}`);
		for (const [name, script] of Object.entries(scripts)) {
			if (!name.endsWith(':bypass'))
				expect(script, name).not.toContain(LOCAL_AUTH_BYPASS_NAME);
		}
	});

	it.each(forbiddenFiles)('is never named in %s', (path) => {
		expect(read(path)).not.toContain('LOCAL_AUTH_BYPASS');
	});
});
