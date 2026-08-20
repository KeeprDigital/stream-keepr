/**
 * Constructs Better Auth under whatever `NODE_ENV` this process was handed and
 * reports what the library's own secret validation did (#438).
 *
 * A separate process because there is no other way to run it: `@better-auth/core`
 * captures `NODE_ENV` into a module-level constant at import
 * (`env-impl.mjs` — `const nodeENV = env.NODE_ENV ?? ""`), so by the time any
 * test could stub the environment, `isTest()` has already decided. The suite
 * that spawns this (`test/unit/server/utils/authSecretValidation.test.ts`) owns
 * the environment instead, which is the ticket's second answer: cover the
 * behaviour in a test that constructs the library itself under an environment
 * it controls.
 *
 * Deliberately *not* built from `authStaticOptions`: what is under test is the
 * library's validation, which reads only the secret and the environment. The
 * one option that matters is `secret`, selected by argv.
 */
import process from 'node:process';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';

const SECRETS = {
	// No secret at all: the library falls back to its well-known default.
	none: undefined,
	// Below the 32-character floor the library warns about.
	short: 'short-secret',
	// Long and high-entropy enough to pass every check silently.
	adequate: 'k9#mQ2$vX7!pL4@wN8%rT3^zB6&dF1*hJ5+gS0-',
};

async function main() {
	const kind = process.argv[2];
	if (!(kind in SECRETS)) {
		process.stdout.write(JSON.stringify({ outcome: 'unknown-case', kind }));
		process.exit(1);
	}

	const warnings = [];
	const secret = SECRETS[kind];

	try {
		const auth = betterAuth({
			// Stated so the only warnings on the channel are the secret's own.
			baseURL: 'http://localhost:3000',
			database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
			...(secret === undefined ? {} : { secret }),
			logger: {
				log: (level, message) => {
					if (level === 'warn' || level === 'error')
						warnings.push(message);
				},
			},
		});
		await auth.$context;
		process.stdout.write(JSON.stringify({ outcome: 'constructed', warnings }));
	}
	catch (failure) {
		process.stdout.write(JSON.stringify({
			outcome: 'refused',
			message: String(failure?.message ?? failure),
			warnings,
		}));
	}
	// Explicit, so a stray rejection of the shared context promise inside the
	// library cannot turn an already-reported result into a non-zero exit.
	process.exit(0);
}

main();
