import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetSession, mockSignInEmail, mockSignOut } = vi.hoisted(() => ({
	mockGetSession: vi.fn(),
	mockSignInEmail: vi.fn(),
	mockSignOut: vi.fn(),
}));

vi.mock('~/modules/auth/client', () => ({
	authClient: {
		getSession: mockGetSession,
		signIn: { email: mockSignInEmail },
		signOut: mockSignOut,
	},
}));

/** A signed-in answer in the shape Better Auth's client returns one. */
function sessionAnswer() {
	return {
		data: {
			user: { id: 'usr_1', email: 'operator@example.test', name: 'Operator' },
			session: { id: 'ses_1' },
		},
		error: null,
	};
}

/**
 * The module holds one session per document, so each test imports it fresh
 * rather than reaching for a reset only tests would ever call.
 */
async function freshSession() {
	vi.resetModules();
	const { useAuthSession } = await import('~/modules/auth/session');
	return useAuthSession();
}

describe('useAuthSession', () => {
	beforeEach(() => {
		mockGetSession.mockReset();
		mockSignInEmail.mockReset();
		mockSignOut.mockReset();
	});

	it('reports the signed-in operator the server answered with', async () => {
		mockGetSession.mockResolvedValue(sessionAnswer());

		const session = await freshSession();
		await session.load();

		expect(session.status.value).toBe('signed-in');
		expect(session.user.value?.email).toBe('operator@example.test');
	});

	it('reports signed out when the server answers with no session', async () => {
		mockGetSession.mockResolvedValue({ data: null, error: null });

		const session = await freshSession();
		await session.load();

		expect(session.status.value).toBe('signed-out');
		expect(session.user.value).toBeNull();
	});

	it('reports unavailable when the ask was refused rather than answered', async () => {
		mockGetSession.mockResolvedValue({
			data: null,
			error: { status: 503, message: 'NUXT_BETTER_AUTH_SECRET is not configured' },
		});

		const session = await freshSession();
		await session.load();

		expect(session.status.value).toBe('unavailable');
	});

	it('reports unavailable when the ask never reached the server', async () => {
		mockGetSession.mockRejectedValue(new Error('Failed to fetch'));

		const session = await freshSession();
		await session.load();

		expect(session.status.value).toBe('unavailable');
	});
});

describe('useAuthSession ensure', () => {
	beforeEach(() => {
		mockGetSession.mockReset();
		mockSignInEmail.mockReset();
		mockSignOut.mockReset();
	});

	it('asks the server once and reuses the answer on later navigations', async () => {
		mockGetSession.mockResolvedValue(sessionAnswer());

		const session = await freshSession();
		await session.ensure();
		await session.ensure();

		expect(mockGetSession).toHaveBeenCalledTimes(1);
	});

	it('asks again after an answer that settled nothing', async () => {
		mockGetSession.mockRejectedValueOnce(new Error('Failed to fetch'));
		mockGetSession.mockResolvedValueOnce(sessionAnswer());

		const session = await freshSession();
		expect(await session.ensure()).toBe('unavailable');
		expect(await session.ensure()).toBe('signed-in');
	});

	it('answers simultaneous asks from one request', async () => {
		let release: (() => void) | undefined;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		mockGetSession.mockImplementation(async () => {
			await held;
			return sessionAnswer();
		});

		const session = await freshSession();
		const both = Promise.all([session.ensure(), session.ensure()]);
		release?.();
		await both;

		expect(mockGetSession).toHaveBeenCalledTimes(1);
	});
});

describe('useAuthSession supersession', () => {
	beforeEach(() => {
		mockGetSession.mockReset();
		mockSignInEmail.mockReset();
		mockSignOut.mockReset();
	});

	/** A `getSession` that hangs until the test lets it answer. */
	function heldGetSession(answer: unknown) {
		let release: (() => void) | undefined;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		mockGetSession.mockImplementation(async () => {
			await held;
			return answer;
		});
		return () => release?.();
	}

	it('does not let a session read that was already in the air undo a sign-in', async () => {
		const release = heldGetSession({ data: null, error: null });
		mockSignInEmail.mockResolvedValue({
			data: { user: { id: 'usr_1', email: 'operator@example.test', name: 'Operator' } },
			error: null,
		});

		const session = await freshSession();
		const reading = session.ensure();
		await session.signIn('operator@example.test', 'correct horse');
		release();
		await reading;

		expect(session.status.value).toBe('signed-in');
		expect(session.user.value?.email).toBe('operator@example.test');
	});

	it('does not let a session read that was already in the air undo a sign-out', async () => {
		mockSignInEmail.mockResolvedValue({
			data: { user: { id: 'usr_1', email: 'operator@example.test', name: 'Operator' } },
			error: null,
		});
		const session = await freshSession();
		await session.signIn('operator@example.test', 'correct horse');

		const release = heldGetSession(sessionAnswer());
		mockSignOut.mockResolvedValue({ data: { success: true }, error: null });

		const reading = session.load();
		await session.signOut();
		release();
		await reading;

		expect(session.status.value).toBe('signed-out');
		expect(session.user.value).toBeNull();
	});
});

describe('useAuthSession signIn', () => {
	beforeEach(() => {
		mockGetSession.mockReset();
		mockSignInEmail.mockReset();
		mockSignOut.mockReset();
	});

	it('signs in and settles the session without asking the server again', async () => {
		mockSignInEmail.mockResolvedValue({
			data: { user: { id: 'usr_1', email: 'operator@example.test', name: 'Operator' } },
			error: null,
		});

		const session = await freshSession();
		const result = await session.signIn('operator@example.test', 'correct horse');

		expect(result).toEqual({ ok: true });
		expect(session.status.value).toBe('signed-in');
		expect(session.user.value?.name).toBe('Operator');
		expect(mockGetSession).not.toHaveBeenCalled();
	});

	it('sends the address without the whitespace an autofill left on it', async () => {
		mockSignInEmail.mockResolvedValue({ data: { user: { id: 'usr_1', email: 'a@b.test', name: 'A' } }, error: null });

		const session = await freshSession();
		await session.signIn('  operator@example.test  ', 'correct horse');

		expect(mockSignInEmail).toHaveBeenCalledWith({
			email: 'operator@example.test',
			password: 'correct horse',
		});
	});

	it('reports the refusal in the server\'s own words and stays signed out', async () => {
		mockSignInEmail.mockResolvedValue({
			data: null,
			error: { status: 401, message: 'Invalid email or password' },
		});

		const session = await freshSession();
		const result = await session.signIn('operator@example.test', 'wrong');

		expect(result).toEqual({ ok: false, message: 'Invalid email or password' });
		expect(session.status.value).toBe('unknown');
		expect(session.user.value).toBeNull();
	});

	it('reports a refusal that arrived with no words of its own', async () => {
		mockSignInEmail.mockRejectedValue(new Error('Failed to fetch'));

		const session = await freshSession();
		const result = await session.signIn('operator@example.test', 'correct horse');

		expect(result.ok).toBe(false);
		expect(result.ok === false && result.message.length > 0).toBe(true);
	});
});

describe('useAuthSession signOut', () => {
	beforeEach(() => {
		mockGetSession.mockReset();
		mockSignInEmail.mockReset();
		mockSignOut.mockReset();
	});

	async function signedInSession() {
		mockSignInEmail.mockResolvedValue({
			data: { user: { id: 'usr_1', email: 'operator@example.test', name: 'Operator' } },
			error: null,
		});
		const session = await freshSession();
		await session.signIn('operator@example.test', 'correct horse');
		return session;
	}

	it('ends the session and forgets who held it', async () => {
		const session = await signedInSession();
		mockSignOut.mockResolvedValue({ data: { success: true }, error: null });

		const result = await session.signOut();

		expect(result).toEqual({ ok: true });
		expect(session.status.value).toBe('signed-out');
		expect(session.user.value).toBeNull();
	});

	it('does not claim to be signed out when the server never agreed', async () => {
		const session = await signedInSession();
		mockSignOut.mockResolvedValue({ data: null, error: { status: 503, message: 'Service Unavailable' } });

		const result = await session.signOut();

		expect(result.ok).toBe(false);
		// Not `signed-out`, which would be a lie, and not `signed-in`, which is
		// no longer known: the next navigation asks the server instead.
		expect(session.status.value).toBe('unknown');
	});

	it('asks the server again after a sign-out that did not land', async () => {
		const session = await signedInSession();
		mockSignOut.mockResolvedValue({ data: null, error: { status: 503, message: 'Service Unavailable' } });
		mockGetSession.mockResolvedValue(sessionAnswer());

		await session.signOut();
		await session.ensure();

		expect(mockGetSession).toHaveBeenCalledTimes(1);
	});
});
