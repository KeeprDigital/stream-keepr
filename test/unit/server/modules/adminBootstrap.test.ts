import type { AdminBootstrapAccount, AdminBootstrapPort } from '~~/server/modules/admin-bootstrap';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { refusalFrom } from '~~/test/helpers/publicServerFailure';

const { mockRuntimeConfig, mockRequestHeader } = vi.hoisted(() => ({
	mockRuntimeConfig: vi.fn(),
	mockRequestHeader: vi.fn(),
}));

vi.stubGlobal('useRuntimeConfig', mockRuntimeConfig);
vi.stubGlobal('getRequestHeader', mockRequestHeader);
vi.stubGlobal('createError', (input: {
	statusCode: number;
	statusMessage?: string;
	message: string;
	cause?: unknown;
}) => Object.assign(new Error(input.message), input));

async function adminBootstrap() {
	return import('~~/server/modules/admin-bootstrap');
}

const CONFIGURED_TOKEN = 'an-armed-bootstrap-token';

/**
 * The first-admin bootstrap's two halves (#394): the secret that arms the route
 * at all, and the create-or-reset it performs once armed.
 *
 * Both are exercised here rather than only against the running server because
 * the disarmed state — the state a deployed installation spends its whole life
 * in — is one the integration suite cannot hold at the same time as the armed
 * one, the environment being fixed for the server it spawns.
 */
describe('the first-admin bootstrap guard', () => {
	beforeEach(() => {
		vi.resetModules();
		mockRuntimeConfig.mockReset().mockReturnValue({ adminBootstrapToken: CONFIGURED_TOKEN });
		mockRequestHeader.mockReset().mockReturnValue(CONFIGURED_TOKEN);
	});

	it('admits a caller presenting the armed token', async () => {
		const { requireAdminBootstrapToken } = await adminBootstrap();

		await expect(requireAdminBootstrapToken(stubH3Event())).resolves.toBeUndefined();
	});

	it('reads the token from the header the ceremony documents', async () => {
		const { requireAdminBootstrapToken, ADMIN_BOOTSTRAP_TOKEN_HEADER } = await adminBootstrap();

		await requireAdminBootstrapToken(stubH3Event());

		// The README's curl and this guard have to name the same header, and a
		// mismatch would present as a 403 for a correctly-typed secret — which reads
		// as a wrong token rather than as a wrong header.
		expect(mockRequestHeader).toHaveBeenCalledWith(expect.anything(), ADMIN_BOOTSTRAP_TOKEN_HEADER);
		expect(ADMIN_BOOTSTRAP_TOKEN_HEADER).toBe('x-admin-bootstrap-token');
	});

	it('refuses a caller presenting the wrong token with 403', async () => {
		mockRequestHeader.mockReturnValue('not-the-token');
		const { requireAdminBootstrapToken } = await adminBootstrap();

		await expect(requireAdminBootstrapToken(stubH3Event())).rejects.toMatchObject({
			statusCode: 403,
			message: 'First-admin bootstrap authorization is required',
		});
	});

	it('refuses a caller presenting no token at all with 403', async () => {
		mockRequestHeader.mockReturnValue(undefined);
		const { requireAdminBootstrapToken } = await adminBootstrap();

		await expect(requireAdminBootstrapToken(stubH3Event())).rejects.toMatchObject({ statusCode: 403 });
	});

	/**
	 * The disarmed state, which is where a deployed installation sits between the
	 * install and the next lockout — so this refusal is read far more often than
	 * the route's success, and 'Internal Server Error' would send the one person
	 * who can act on it to the logs of a server behaving exactly as configured
	 * (#233, #321, and now a third module).
	 *
	 * Asserted after the mapper, which is where the rewrite happens and the only
	 * place the classification is observable.
	 */
	it('names the setting when the route is not armed', async () => {
		mockRuntimeConfig.mockReturnValue({ adminBootstrapToken: '   ' });
		const { requireAdminBootstrapToken } = await adminBootstrap();

		const failure = await refusalFrom(requireAdminBootstrapToken(stubH3Event()));
		// Imported here rather than at the top of the file: `vi.resetModules()` gives
		// the guard a fresh copy of the errors module, and a statically bound class
		// would be a different one — the `instanceof` would read false for a
		// correctly classified refusal.
		const { ServiceConfigurationError } = await import('~~/server/utils/errors');

		expect(failure).toMatchObject({
			statusCode: 503,
			statusMessage: 'Service Unavailable',
			message: 'NUXT_ADMIN_BOOTSTRAP_TOKEN is not configured, so first-admin bootstrap is unavailable',
		});
		expect(failure.cause).toBeInstanceOf(ServiceConfigurationError);
	});

	it('names a setting and never a value', async () => {
		mockRuntimeConfig.mockReturnValue({ adminBootstrapToken: '' });
		mockRequestHeader.mockReturnValue('a-supplied-token');
		const { requireAdminBootstrapToken } = await adminBootstrap();

		const failure = await refusalFrom(requireAdminBootstrapToken(stubH3Event()));

		expect(failure.message).not.toContain('a-supplied-token');
	});

	it('checks the token before it reads anything else about the request', async () => {
		// The disarmed 503 must not be reachable only after a body parse: a route
		// that validated first would answer a malformed curl with 400 on an
		// installation where the honest answer is "this is not armed".
		mockRuntimeConfig.mockReturnValue({ adminBootstrapToken: '' });
		const { requireAdminBootstrapToken } = await adminBootstrap();

		await expect(requireAdminBootstrapToken(stubH3Event())).rejects.toMatchObject({ statusCode: 503 });
		expect(mockRequestHeader).not.toHaveBeenCalled();
	});
});

/** A port over an in-memory account, recording what the decision asked of it. */
function stubPort(existing?: AdminBootstrapAccount, overrides: Partial<AdminBootstrapPort> = {}) {
	const passwords: string[] = [];
	const roleWrites: string[][] = [];
	const created: { email: string; password: string; name: string }[] = [];

	const port: AdminBootstrapPort = {
		minPasswordLength: 8,
		maxPasswordLength: 128,
		findByEmail: async () => existing ?? null,
		createAdmin: async (input) => {
			created.push(input);
			return { id: 'created-user-id', roles: ['admin'] };
		},
		setPassword: async (_userId, password) => {
			passwords.push(password);
		},
		setRoles: async (_userId, roles) => {
			roleWrites.push([...roles]);
		},
		...overrides,
	};

	return { port, passwords, roleWrites, created };
}

const VALID_PASSWORD = 'a-long-enough-password';

describe('ensuring the first admin account', () => {
	it('creates an admin when the email is unknown', async () => {
		const { ensureAdminAccount } = await adminBootstrap();
		const { port, created } = stubPort();

		const outcome = await ensureAdminAccount(port, {
			email: 'first@keepr.digital',
			password: VALID_PASSWORD,
			name: 'First Admin',
		});

		expect(outcome).toEqual({
			outcome: 'created',
			userId: 'created-user-id',
			email: 'first@keepr.digital',
			grantedAdminRole: true,
		});
		expect(created).toEqual([{
			email: 'first@keepr.digital',
			password: VALID_PASSWORD,
			name: 'First Admin',
		}]);
	});

	it('names a created account after its email when no name is given', async () => {
		// A required name would be one more thing to get right in a terminal during
		// a lockout, and an empty one would leave the cockpit attributing work to a
		// blank.
		const { ensureAdminAccount } = await adminBootstrap();
		const { port, created } = stubPort();

		await ensureAdminAccount(port, { email: 'first@keepr.digital', password: VALID_PASSWORD });

		expect(created[0]?.name).toBe('first@keepr.digital');
	});

	it('falls back to the email when the name given is only whitespace', async () => {
		const { ensureAdminAccount } = await adminBootstrap();
		const { port, created } = stubPort();

		await ensureAdminAccount(port, { email: 'first@keepr.digital', password: VALID_PASSWORD, name: '  ' });

		expect(created[0]?.name).toBe('first@keepr.digital');
	});

	/**
	 * The break-glass half. Create-only would answer a locked-out operator with
	 * "that email is taken" — an account they cannot sign in to, under an address
	 * they cannot reuse, which is the lockout again with an extra step.
	 */
	it('sets the password on an account that already exists', async () => {
		const { ensureAdminAccount } = await adminBootstrap();
		const { port, passwords, created } = stubPort({ id: 'existing-user-id', roles: ['admin'] });

		const outcome = await ensureAdminAccount(port, {
			email: 'first@keepr.digital',
			password: 'the-recovery-password',
		});

		expect(outcome).toEqual({
			outcome: 'updated',
			userId: 'existing-user-id',
			email: 'first@keepr.digital',
			grantedAdminRole: false,
		});
		expect(passwords).toEqual(['the-recovery-password']);
		expect(created).toEqual([]);
	});

	it('leaves an existing account its own name', async () => {
		// The Evidence Ledger resolves display names at read time, so overwriting
		// one here would rewrite what past entries are attributed to. `createAdmin`
		// is the only port operation that carries a name, so the name given cannot
		// reach the account unless that is called.
		const { ensureAdminAccount } = await adminBootstrap();
		const { port, created } = stubPort({ id: 'existing-user-id', roles: ['admin'] });

		await ensureAdminAccount(port, {
			email: 'first@keepr.digital',
			password: VALID_PASSWORD,
			name: 'A Different Name',
		});

		expect(created).toEqual([]);
	});

	it('grants the admin role to an existing account that lacks it', async () => {
		const { ensureAdminAccount } = await adminBootstrap();
		const { port, roleWrites } = stubPort({ id: 'existing-user-id', roles: ['user'] });

		const outcome = await ensureAdminAccount(port, {
			email: 'first@keepr.digital',
			password: VALID_PASSWORD,
		});

		expect(outcome.grantedAdminRole).toBe(true);
		// Appended, not replaced: whatever else this account was, it stays.
		expect(roleWrites).toEqual([['user', 'admin']]);
	});

	it('grants the admin role to an account carrying no role at all', async () => {
		const { ensureAdminAccount } = await adminBootstrap();
		const { port, roleWrites } = stubPort({ id: 'existing-user-id', roles: [] });

		await ensureAdminAccount(port, { email: 'first@keepr.digital', password: VALID_PASSWORD });

		expect(roleWrites).toEqual([['admin']]);
	});

	it('leaves the roles alone when admin is already among several', async () => {
		const { ensureAdminAccount } = await adminBootstrap();
		const { port, roleWrites } = stubPort({ id: 'existing-user-id', roles: ['user', 'admin'] });

		const outcome = await ensureAdminAccount(port, {
			email: 'first@keepr.digital',
			password: VALID_PASSWORD,
		});

		expect(outcome.grantedAdminRole).toBe(false);
		expect(roleWrites).toEqual([]);
	});

	it('is idempotent: the same call twice leaves one account in the same state', async () => {
		const { ensureAdminAccount } = await adminBootstrap();
		let account: AdminBootstrapAccount | null = null;
		const created: unknown[] = [];
		const port: AdminBootstrapPort = {
			minPasswordLength: 8,
			maxPasswordLength: 128,
			findByEmail: async () => account,
			createAdmin: async (input) => {
				created.push(input);
				account = { id: 'created-user-id', roles: ['admin'] };
				return account;
			},
			setPassword: async () => {},
			setRoles: async () => {},
		};
		const request = { email: 'first@keepr.digital', password: VALID_PASSWORD };

		const first = await ensureAdminAccount(port, request);
		const second = await ensureAdminAccount(port, request);

		expect(first.outcome).toBe('created');
		expect(second).toMatchObject({ outcome: 'updated', userId: first.userId, grantedAdminRole: false });
		expect(created).toHaveLength(1);
	});

	it('looks the account up under the email Better Auth would have stored', async () => {
		// The port interface promises nothing about case, so the decision normalizes
		// rather than relying on whoever implements it. The Better Auth port would
		// survive this being removed — `findUserByEmail` lowercases its own argument
		// — which is exactly why the contract is pinned here, against a port that
		// does not.
		const { ensureAdminAccount } = await adminBootstrap();
		const lookups: string[] = [];
		const { port } = stubPort(undefined, {
			findByEmail: async (email) => {
				lookups.push(email);
				return null;
			},
		});

		const outcome = await ensureAdminAccount(port, {
			email: '  First@Keepr.Digital ',
			password: VALID_PASSWORD,
		});

		expect(lookups).toEqual(['first@keepr.digital']);
		expect(outcome.email).toBe('first@keepr.digital');
	});

	/**
	 * `createUser` checks neither bound itself — unlike `signUpEmail` and
	 * `setUserPassword`, both of which do — so without this an empty password
	 * hashes and stores perfectly happily, and the installation's first admin has
	 * a credential anyone can present.
	 */
	it('refuses a password shorter than the configured minimum, before writing anything', async () => {
		const { ensureAdminAccount } = await adminBootstrap();
		const { port, created, passwords } = stubPort();

		await expect(ensureAdminAccount(port, { email: 'first@keepr.digital', password: 'short' }))
			.rejects
			.toMatchObject({ statusCode: 400, message: 'Password must be at least 8 characters' });
		expect(created).toEqual([]);
		expect(passwords).toEqual([]);
	});

	it('refuses a password longer than the configured maximum', async () => {
		const { ensureAdminAccount } = await adminBootstrap();
		const { port, created } = stubPort();

		await expect(ensureAdminAccount(port, { email: 'first@keepr.digital', password: 'x'.repeat(129) }))
			.rejects
			.toMatchObject({ statusCode: 400, message: 'Password must be at most 128 characters' });
		expect(created).toEqual([]);
	});

	it('quotes the port\'s bounds rather than bounds of its own', async () => {
		// The numbers come from Better Auth's running configuration. Restating them
		// here would let this route admit a password the sign-in path rejects.
		const { ensureAdminAccount } = await adminBootstrap();
		const { port } = stubPort(undefined, { minPasswordLength: 12 });

		await expect(ensureAdminAccount(port, { email: 'first@keepr.digital', password: 'nine-char' }))
			.rejects
			.toMatchObject({ message: 'Password must be at least 12 characters' });
	});

	it('never puts the password in a refusal', async () => {
		const { ensureAdminAccount } = await adminBootstrap();
		const { port } = stubPort();

		await expect(ensureAdminAccount(port, { email: 'first@keepr.digital', password: 'secret1' }))
			.rejects
			.toSatisfy((error: Error) => !error.message.includes('secret1'));
	});
});
