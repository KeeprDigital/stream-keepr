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

// The disarmed state is the one the integration suite cannot hold beside the
// armed one, so the guard is exercised here (#394).
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

	// The disarmed refusal is read far more often than success, so it names the setting (#233, #321).
	it('names the setting when the route is not armed', async () => {
		mockRuntimeConfig.mockReturnValue({ adminBootstrapToken: '   ' });
		const { requireAdminBootstrapToken } = await adminBootstrap();

		const failure = await refusalFrom(requireAdminBootstrapToken(stubH3Event()));
		// Imported after resetModules so `instanceof` sees the guard's copy of the class.
		const { ServiceConfigurationError } = await import('~~/server/utils/errors');

		expect(failure).toMatchObject({
			statusCode: 503,
			statusMessage: 'Service Unavailable',
			message: 'NUXT_ADMIN_BOOTSTRAP_TOKEN is not configured, so first-admin bootstrap is unavailable',
		});
		expect(failure.cause).toBeInstanceOf(ServiceConfigurationError);
	});

	// Nuxt reads NUXT_* through destr: an all-digit or boolean token is not a string.
	it.each([
		['all digits', 482915736104],
		['true', true],
	])('names the setting when the token does not read as text (%s)', async (_label, configured) => {
		mockRuntimeConfig.mockReturnValue({ adminBootstrapToken: configured });
		const { requireAdminBootstrapToken } = await adminBootstrap();

		const failure = await refusalFrom(requireAdminBootstrapToken(stubH3Event()));
		const { ServiceConfigurationError } = await import('~~/server/utils/errors');

		expect(failure).toMatchObject({
			statusCode: 503,
			statusMessage: 'Service Unavailable',
			message: 'NUXT_ADMIN_BOOTSTRAP_TOKEN does not read as text (a value of only digits, true/false or JSON is read as another type), so it cannot be checked: set one that contains a letter',
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
			return {
				id: 'created-user-id',
				roles: ['admin'],
			};
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
		expect(created).toEqual([
			{
				email: 'first@keepr.digital',
				password: VALID_PASSWORD,
				name: 'First Admin',
			},
		]);
	});

	it('names a created account after its email when no name is given', async () => {
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

	// The break-glass half: an existing account is reset, not refused.
	it('sets the password on an account that already exists', async () => {
		const { ensureAdminAccount } = await adminBootstrap();
		const { port, passwords, created } = stubPort({
			id: 'existing-user-id',
			roles: ['admin'],
		});

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
		// Renaming would rewrite who past Evidence Ledger entries are attributed to.
		const { ensureAdminAccount } = await adminBootstrap();
		const { port, created } = stubPort({
			id: 'existing-user-id',
			roles: ['admin'],
		});

		await ensureAdminAccount(port, {
			email: 'first@keepr.digital',
			password: VALID_PASSWORD,
			name: 'A Different Name',
		});

		expect(created).toEqual([]);
	});

	it('grants the admin role to an existing account that lacks it', async () => {
		const { ensureAdminAccount } = await adminBootstrap();
		const { port, roleWrites } = stubPort({
			id: 'existing-user-id',
			roles: ['user'],
		});

		const outcome = await ensureAdminAccount(port, {
			email: 'first@keepr.digital',
			password: VALID_PASSWORD,
		});

		expect(outcome.grantedAdminRole).toBe(true);
		// Appended, not replaced: whatever else this account was, it stays.
		expect(roleWrites).toEqual([
			['user', 'admin'],
		]);
	});

	it('grants the admin role to an account carrying no role at all', async () => {
		const { ensureAdminAccount } = await adminBootstrap();
		const { port, roleWrites } = stubPort({ id: 'existing-user-id', roles: [] });

		await ensureAdminAccount(port, { email: 'first@keepr.digital', password: VALID_PASSWORD });

		expect(roleWrites).toEqual([
			['admin'],
		]);
	});

	it('leaves the roles alone when admin is already among several', async () => {
		const { ensureAdminAccount } = await adminBootstrap();
		const { port, roleWrites } = stubPort({
			id: 'existing-user-id',
			roles: ['user', 'admin'],
		});

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
				account = {
					id: 'created-user-id',
					roles: ['admin'],
				};
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
		// The port promises nothing about case, so the decision normalizes itself.
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

	// Better Auth's createUser checks neither bound itself.
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

		await expect(ensureAdminAccount(port, {
			email: 'first@keepr.digital',
			password: 'x'.repeat(129),
		}))
			.rejects
			.toMatchObject({ statusCode: 400, message: 'Password must be at most 128 characters' });
		expect(created).toEqual([]);
	});

	it('quotes the port\'s bounds rather than bounds of its own', async () => {
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
