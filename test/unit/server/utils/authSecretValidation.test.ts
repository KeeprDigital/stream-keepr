import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Better Auth's own secret validation, run under the one environment where it
 * does anything (#438).
 *
 * `validateSecret` opens with `if (isTest()) return;`
 * (`better-auth/dist/context/create-context.mjs`), so the refusals and warnings
 * a weak, short or defaulted secret produces are unreachable from any test that
 * merely constructs the library in-process — vitest sets `NODE_ENV` to `test`,
 * and `@better-auth/core` freezes that answer at import. This repository guards
 * the *blank* secret itself (`serverAuth` refuses before the library is
 * constructed; pinned in `auth.test.ts`), but everything past blank — the
 * well-known default, the 32-character floor — is the library's own gate, and
 * until this file nothing exercised it.
 *
 * So these cases construct the library in a child process handed
 * `NODE_ENV=production` (see `test/helpers/betterAuthSecretProbe.mjs` for why a
 * process boundary is the only seam that works), and pin what the pinned
 * version does there. The last case runs the same construction under
 * `NODE_ENV=test` and pins the blindness itself: a secretless Better Auth
 * constructs silently and would sign every session with a string printed in the
 * library's source. If a version bump changes any of these answers, this file
 * is where the change surfaces.
 */

const PROBE = fileURLToPath(new URL('../../../helpers/betterAuthSecretProbe.mjs', import.meta.url));

interface ProbeReport {
	outcome: 'constructed' | 'refused' | 'unknown-case';
	message?: string;
	warnings: string[];
}

function probe(kind: 'none' | 'short' | 'adequate', nodeEnv: 'production' | 'test'): ProbeReport {
	// The names the library reads secrets and environment answers from, held
	// out of the child so the case's own inputs are the only ones present.
	const {
		BETTER_AUTH_SECRET: _secret,
		BETTER_AUTH_SECRETS: _secrets,
		AUTH_SECRET: _authSecret,
		TEST: _test,
		...inherited
	} = process.env;

	const result = spawnSync(process.execPath, [PROBE, kind], {
		env: { ...inherited, NODE_ENV: nodeEnv },
		encoding: 'utf8',
		timeout: 30_000,
	});
	expect(result.error).toBeUndefined();
	expect(result.status).toBe(0);
	return JSON.parse(result.stdout) as ProbeReport;
}

describe('the secret validation the suite cannot otherwise reach, under NODE_ENV=production', () => {
	it('refuses to construct on the well-known default secret', () => {
		const report = probe('none', 'production');
		expect(report.outcome).toBe('refused');
		expect(report.message).toMatch(/default secret/i);
	});

	it('warns on a secret below the 32-character floor', () => {
		const report = probe('short', 'production');
		expect(report.outcome).toBe('constructed');
		expect(report.warnings.join('\n')).toMatch(/32 characters/);
	});

	it('constructs silently on an adequate secret', () => {
		const report = probe('adequate', 'production');
		expect(report.outcome).toBe('constructed');
		expect(report.warnings.filter(warning => /secret/i.test(warning))).toEqual([]);
	});
});

describe('the same construction under NODE_ENV=test — the blindness on record', () => {
	it('admits the default secret without a word', () => {
		const report = probe('none', 'test');
		expect(report.outcome).toBe('constructed');
		expect(report.warnings.filter(warning => /secret/i.test(warning))).toEqual([]);
	});
});
