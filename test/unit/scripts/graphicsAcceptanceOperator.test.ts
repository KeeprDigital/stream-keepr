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

/**
 * How an acceptance run becomes somebody (#396).
 *
 * Every route in `routes.mjs` outside the Screen Output surface sits behind the
 * deny-by-default boundary, so a harness with no session proves nothing — and
 * proves it in the most misleading way available, since a 401 on the first
 * provisioning request reads as an unready installation.
 *
 * The decision is pure so it can be read in every state without an installation
 * in front of it. The state that matters most is the one no test could reach by
 * accident: a **deployed** run must not be able to take a local `.dev.vars`
 * secret and send it to a remote host.
 */

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
		const plan = planFor({ env: { [BOOTSTRAP_TOKEN_NAME]: A_TOKEN }, newPassword: PASSWORD });

		expect(plan).toEqual({
			kind: 'bootstrap',
			email: HARNESS_OPERATOR_EMAIL,
			password: PASSWORD,
			bootstrapToken: A_TOKEN,
		});
	});

	it('takes the token from the checkout for a local run', () => {
		// The ordinary local path: `.env` or `.dev.vars` carries the token, which is
		// why #396 made that name one a local run is checked for.
		const plan = planFor({ supplied: { [BOOTSTRAP_TOKEN_NAME]: A_TOKEN }, newPassword: PASSWORD });

		expect(plan).toMatchObject({ kind: 'bootstrap', bootstrapToken: A_TOKEN });
	});

	it('never sends a checkout\'s own secret to a deployed installation', () => {
		// The one state a default must not reach. A deployed origin is a remote
		// host, and this checkout's `.dev.vars` is not its secret to present.
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

	it('counts a blank as absent, the way every other reader here does', () => {
		expect(() => planFor({
			env: { [OPERATOR_EMAIL_ENV]: 'ops@keepr.digital', [OPERATOR_PASSWORD_ENV]: '   ', [BOOTSTRAP_TOKEN_NAME]: '' },
			newPassword: PASSWORD,
		})).toThrow(expect.objectContaining({ code: 'harness-operator-unavailable' }));
	});

	it('refuses half a credential rather than signing in with an empty password', () => {
		expect(() => planFor({ env: { [OPERATOR_EMAIL_ENV]: 'ops@keepr.digital' }, newPassword: PASSWORD }))
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

	it('owns its own account rather than a developer\'s, because ensure is create-or-reset', () => {
		// A shared address would mean every acceptance run silently changed the
		// password of the account somebody signs in with by hand.
		expect(HARNESS_OPERATOR_EMAIL).toContain('acceptance');
	});

	it('generates a password rather than carrying one, so nothing in the repository is a credential', () => {
		// A literal here would be a source-known password on an admin account, and
		// ensure would arm it on whatever installation the run was pointed at.
		const first = newOperatorPassword();

		expect(first).not.toBe(newOperatorPassword());
		expect(first.length).toBeGreaterThanOrEqual(16);
	});
});

/**
 * Where a checkout's own secrets may travel, for the callers that have no
 * `--deployed` flag to decide it with.
 *
 * The measurement probes in `scripts/` take one mandatory origin and nothing else,
 * so for them the question really is about the host. The expensive direction is
 * unmistakable: reading `true` for a remote origin means presenting this
 * checkout's `.dev.vars` secret to somebody else's installation.
 */
describe('whether local secrets may reach an origin', () => {
	it('says yes to a server on this machine', () => {
		for (const origin of ['http://127.0.0.1:8787', 'http://localhost:3000', 'http://[::1]:8787', 'http://0.0.0.0:8787'])
			expect(isLoopbackOrigin(origin)).toBe(true);
	});

	it('says no to anything else, including something that only looks local', () => {
		for (const origin of [
			'https://stream.keepr.digital',
			'https://stream.example.workers.dev',
			// A host whose *name* starts like a loopback address, which a prefix test
			// would wave through.
			'https://127.0.0.1.evil.example',
			'https://localhost.evil.example',
			'not-a-url',
			'',
		])
			expect(isLoopbackOrigin(origin)).toBe(false);
	});
});

/**
 * The notice, read as prose in both modes — the #130 lesson applied again: a
 * sentence that sends its reader after a file that could not have helped is worse
 * than no sentence.
 */
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

		expect(notice).not.toContain('.dev.vars');
		expect(notice).not.toContain('worktree');
		expect(notice).toContain(OPERATOR_EMAIL_ENV);
		expect(notice).toContain(OPERATOR_PASSWORD_ENV);
	});

	it('says why the boundary makes this fatal rather than merely inconvenient', () => {
		for (const deployed of [true, false])
			expect(operatorUnavailableNotice({ deployed })).toContain('401');
	});
});
