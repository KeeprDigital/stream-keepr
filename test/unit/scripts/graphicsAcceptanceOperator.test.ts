import { describe, expect, it, vi } from 'vitest';
import { ACCEPTANCE_FAILURE_CODES } from '../../../scripts/graphics-acceptance/evidence.mjs';
import {
	BOOTSTRAP_TOKEN_NAME,
	HARNESS_OPERATOR_EMAIL,
	isLoopbackOrigin,
	newOperatorPassword,
	OPERATOR_EMAIL_ENV,
	OPERATOR_PASSWORD_ENV,
	operatorCredentialPlan,
	operatorUnavailableNotice,
} from '../../../scripts/graphics-acceptance/operator.mjs';

// How an acceptance run becomes an operator behind the deny-by-default boundary
// (#396). Above all, a deployed run must never send a local `.env` secret to a remote host.

const A_TOKEN = 'a-bootstrap-token';
const PASSWORD = 'a-generated-password';

/** The plan for an environment, with stderr silenced where it refuses. */
function planFor(options: Parameters<typeof operatorCredentialPlan>[0]) {
	vi.spyOn(process.stderr, 'write').mockReturnValue(true);
	return operatorCredentialPlan(options);
}

describe('how an acceptance run acquires an operator', () => {
	it('signs in as the account the environment names', () => {
		const plan = planFor({
			env: { [OPERATOR_EMAIL_ENV]: 'ops@keepr.digital', [OPERATOR_PASSWORD_ENV]: 'their-password' },
			newPassword: PASSWORD,
		});

		expect(plan).toEqual({ kind: 'sign-in', email: 'ops@keepr.digital', password: 'their-password' });
	});

	it('prefers a named account to the bootstrap, so a run never resets an account it was not asked to', () => {
		// Ensure is create-or-reset. A run that bootstrapped in preference to
		// signing in would change the password of whichever account it aimed at,
		// which is a side effect nobody asked a read-only gate for.
		const plan = planFor({
			env: {
				[OPERATOR_EMAIL_ENV]: 'ops@keepr.digital',
				[OPERATOR_PASSWORD_ENV]: 'their-password',
				[BOOTSTRAP_TOKEN_NAME]: A_TOKEN,
			},
			newPassword: PASSWORD,
		});

		expect(plan.kind).toBe('sign-in');
	});

	it('bootstraps its own account when only a token is available', () => {
		const plan = planFor({
			env: { [BOOTSTRAP_TOKEN_NAME]: A_TOKEN },
			newPassword: PASSWORD,
		});

		expect(plan).toEqual({
			kind: 'bootstrap',
			email: HARNESS_OPERATOR_EMAIL,
			password: PASSWORD,
			bootstrapToken: A_TOKEN,
		});
	});

	it('takes the token from the checkout for a local run', () => {
		// The ordinary local path: `.env` carries the token, which is
		// why #396 made that name one a local run is checked for.
		const plan = planFor({
			supplied: { [BOOTSTRAP_TOKEN_NAME]: A_TOKEN },
			newPassword: PASSWORD,
		});

		expect(plan).toMatchObject({ kind: 'bootstrap', bootstrapToken: A_TOKEN });
	});

	it('never sends a checkout\'s own secret to a deployed installation', () => {
		// The one state a default must not reach. A deployed origin is a remote
		// host, and this checkout's `.env` is not its secret to present.
		expect(() => planFor({
			deployed: true,
			supplied: { [BOOTSTRAP_TOKEN_NAME]: A_TOKEN },
			newPassword: PASSWORD,
		})).toThrow(expect.objectContaining({ code: 'harness-operator-unavailable' }));
	});

	it('takes a token from the shell even when deployed, because that is the operator saying so', () => {
		// Not a default: somebody typed it into this shell for this run, which is
		// the same act as arming the secret on the installation.
		const plan = planFor({
			deployed: true,
			env: { [BOOTSTRAP_TOKEN_NAME]: A_TOKEN },
			newPassword: PASSWORD,
		});

		expect(plan).toMatchObject({ kind: 'bootstrap', bootstrapToken: A_TOKEN });
	});

	it.each([
		[
			'blank values',
			{ [OPERATOR_EMAIL_ENV]: 'ops@keepr.digital', [OPERATOR_PASSWORD_ENV]: '   ', [BOOTSTRAP_TOKEN_NAME]: '' },
		],
		[
			'half a credential',
			{ [OPERATOR_EMAIL_ENV]: 'ops@keepr.digital' },
		],
	])('refuses %s rather than signing in with an empty password', (_, env) => {
		expect(() => planFor({ env, newPassword: PASSWORD }))
			.toThrow(expect.objectContaining({ code: 'harness-operator-unavailable' }));
	});

	it('stops with a registered code, and prose above it', () => {
		const written = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

		expect(() => operatorCredentialPlan({ env: {}, newPassword: PASSWORD }))
			.toThrow(expect.objectContaining({
				code: 'harness-operator-unavailable',
				detail: { mode: 'local' },
			}));
		expect(ACCEPTANCE_FAILURE_CODES).toContain('harness-operator-unavailable');
		expect(written).toHaveBeenCalledTimes(1);
		expect(written.mock.calls[0]![0]).toBe(`${operatorUnavailableNotice({ deployed: false })}\n`);
	});

	it('generates a password rather than carrying one, so nothing in the repository is a credential', () => {
		const first = newOperatorPassword();

		expect(first).not.toBe(newOperatorPassword());
		expect(first.length).toBeGreaterThanOrEqual(16);
	});
});

// Reading `true` for a remote origin would present this checkout's `.env` secret to it.
describe('whether local secrets may reach an origin', () => {
	it.each([
		'http://127.0.0.1:8787',
		'http://localhost:3000',
		'http://[::1]:8787',
		'http://0.0.0.0:8787',
	])(
		'says yes to %s, a server on this machine',
		(origin) => {
			expect(isLoopbackOrigin(origin)).toBe(true);
		},
	);

	it.each([
		'https://stream.keepr.digital',
		'https://127.0.0.1.evil.example',
		'https://localhost.evil.example',
		'not-a-url',
		'',
	])('says no to %j, including a host that only looks local', (origin) => {
		expect(isLoopbackOrigin(origin)).toBe(false);
	});
});

describe('what a run with no operator says', () => {
	it('sends a local reader to the two gitignored files it is probably missing', () => {
		const notice = operatorUnavailableNotice({ deployed: false });

		expect(notice).toContain(BOOTSTRAP_TOKEN_NAME);
		expect(notice).toMatch(/\.env(?!\.example)/);
		expect(notice).toContain('git worktree');
		expect(notice).toContain('Fix:');
	});

	it('does not send a deployed reader after a local file, which it never reads', () => {
		const notice = operatorUnavailableNotice({ deployed: true });

		expect(notice).not.toContain('.env');
		expect(notice).not.toContain('worktree');
		expect(notice).toContain(OPERATOR_EMAIL_ENV);
		expect(notice).toContain(OPERATOR_PASSWORD_ENV);
	});

	it('says why the boundary makes this fatal rather than merely inconvenient', () => {
		for (const deployed of [true, false])
			expect(operatorUnavailableNotice({ deployed })).toContain('401');
	});
});
