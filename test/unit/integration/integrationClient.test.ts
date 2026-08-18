import { readFileSync } from 'node:fs';
import { basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { typeScriptFilesUnder } from '~~/test/helpers/routeRefusalScan';

/**
 * That every integration suite talks to the installation as a signed-in operator
 * (#396).
 *
 * ADR-0010's boundary leaves no unauthenticated client for these routes, so the
 * suite has one door — `test/integration/client.ts` — and a suite that imported
 * `@nuxt/test-utils/e2e` directly would get 401 from its first request. That is a
 * loud failure, but a badly aimed one: it looks like the boundary is broken rather
 * than like the import is wrong, and it costs whoever meets it the same half hour
 * every time. Naming the rule here spends one line to say it once.
 *
 * It is checkable as text because the thing being ruled out *is* a line of text.
 * The alternative — asserting behaviour — would need a real server per suite and
 * would still only cover the suites that exist today.
 */

const INTEGRATION_DIRECTORY = fileURLToPath(new URL('../../integration/', import.meta.url));
const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** The one file allowed to import the raw helpers, being the thing that wraps them. */
const CLIENT = 'client.ts';

const files = typeScriptFilesUnder(INTEGRATION_DIRECTORY);

describe('the integration suite\'s HTTP client', () => {
	it('is found at all, so this cannot pass by scanning nothing', () => {
		expect(files.length).toBeGreaterThan(40);
		expect(files.map(file => basename(file))).toContain(CLIENT);
	});

	it('is the only file that names the unauthenticated helpers', () => {
		const offenders = files
			.filter(file => basename(file) !== CLIENT)
			.filter(file => readFileSync(file, 'utf8').includes('@nuxt/test-utils/e2e'))
			.map(file => relative(REPOSITORY_ROOT, file));

		expect(offenders).toEqual([]);
	});

	it('wraps the helpers rather than reimplementing them', () => {
		// The negative control for the row above: it would pass just as well against
		// a client that had stopped importing them, which is a suite talking to
		// nothing.
		const client = readFileSync(new URL(`../../integration/${CLIENT}`, import.meta.url), 'utf8');

		expect(client).toContain('@nuxt/test-utils/e2e');
	});

	it('offers a deliberate way to send no session, so the boundary can be tested', () => {
		// Without this, the only way to make an anonymous request would be the raw
		// import the rule above forbids — and a rule with no sanctioned alternative
		// is a rule somebody has to break.
		const client = readFileSync(new URL(`../../integration/${CLIENT}`, import.meta.url), 'utf8');

		expect(client).toContain('anonymousFetch');
	});
});
