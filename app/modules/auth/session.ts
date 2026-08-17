import { createGuardedSequence } from '~/utils/guardedSequence';
import { authClient } from './client';

/** Who this browser is signed in as, as much of it as any surface here needs. */
export interface AuthSessionUser {
	id: string;
	email: string;
	name: string;
}

/**
 * What this browser knows about its own session.
 *
 * `unavailable` is the load-bearing one, and it is deliberately not folded into
 * `signed-out`. The two look identical from a caller that only asks "is there a
 * user?", but they are opposite answers to the question the page gate asks: the
 * server *said* there is no session, versus the server did not say. Only the
 * first is grounds for taking an operator away from the page they are on —
 * ADR-0010 gates pages for UX and leaves security to the API boundary, so a
 * blip during a navigation must not cost a show its control surface. The
 * refusal it most often names is the server's own 503 for a missing
 * `NUXT_BETTER_AUTH_SECRET`, where signing in would fail too and bouncing there
 * would only relocate the outage.
 */
export type AuthSessionStatus = 'unknown' | 'signed-in' | 'signed-out' | 'unavailable';

/** One answer to "who is this browser", before anything has been made of it. */
interface SessionReading {
	status: AuthSessionStatus;
	user: AuthSessionUser | null;
}

/** What a sign-in or a sign-out did, and what to say where it did not. */
export type AuthAttempt = { ok: true } | { ok: false; message: string };

/**
 * What a failed sign-in says when the failure brought no sentence of its own.
 *
 * A request that never reached the server has only the transport's words —
 * 'Failed to fetch' — which name neither the thing that failed nor anything the
 * operator could do next.
 */
export const SIGN_IN_FAILED_MESSAGE = 'Could not reach the sign-in service. Check your connection and try again.';

/** The same, for the sign-out that could not be delivered. */
export const SIGN_OUT_FAILED_MESSAGE = 'Could not sign out — the session is still open. Try again.';

/**
 * One session per document, held in module scope rather than `useState`.
 *
 * The app is `ssr: false`, so there is exactly one Nuxt app per page load and
 * exactly one browser behind it; the per-request isolation `useState` exists to
 * provide has nothing here to isolate. Module scope is what lets the route
 * middleware read the session without a component to hang it on.
 */
const status = ref<AuthSessionStatus>('unknown');
const user = ref<AuthSessionUser | null>(null);

/**
 * The ask currently in the air, so simultaneous callers share one request.
 *
 * The page gate runs on every navigation and a first navigation can fan out
 * into several before the first answer lands. Held here rather than in `status`
 * because a promise is not state a template should see.
 */
let asking: Promise<AuthSessionStatus> | null = null;

/**
 * Reads are supersedable work, and a sign-in or a sign-out supersedes them.
 *
 * A read asks "who is this browser"; a sign-in *changes* who this browser is.
 * When the two overlap — an operator signs in on the login page while the
 * gate's own read is still in the air — the read's answer describes the
 * browser as it was a moment ago, and applying it would sign the operator
 * straight back out on their next navigation. The Flight is checked at the one
 * place the answer becomes state.
 */
const sessionReads = createGuardedSequence();

/** The session this browser is working under. */
export function useAuthSession() {
	/**
	 * Asks the server who this browser is.
	 *
	 * Both failure shapes land on `unavailable` because they mean the same
	 * thing: Better Auth's client answers a refused request with an `error`
	 * rather than a rejection, and only a request that never reached the fetch
	 * at all throws. Neither is the server saying there is no session.
	 */
	async function read(): Promise<SessionReading> {
		try {
			const answer = await authClient.getSession();

			if (answer.error)
				return { status: 'unavailable', user: null };

			const found = answer.data?.user ?? null;
			return { status: found ? 'signed-in' : 'signed-out', user: found };
		}
		catch {
			return { status: 'unavailable', user: null };
		}
	}

	/** Asks the server, unconditionally, and applies the answer if it is still the newest one. */
	async function load(): Promise<AuthSessionStatus> {
		asking ??= askOnce();

		return asking;
	}

	async function askOnce(): Promise<AuthSessionStatus> {
		const flight = sessionReads.begin();

		try {
			const reading = await read();

			// The one place a read becomes state, and so the one place the guard
			// belongs. A stale reading is dropped whole — including its `user`,
			// which is why `read` returns the pair rather than writing as it goes.
			if (flight.current) {
				status.value = reading.status;
				user.value = reading.user;
			}

			return status.value;
		}
		finally {
			asking = null;
		}
	}

	/**
	 * The status, asking for it only if this browser does not already have a
	 * settled one.
	 *
	 * `signed-in` and `signed-out` are settled: the server said so, and it will
	 * say so again on the next request the page makes, so re-asking on every
	 * navigation would buy nothing. `unknown` has never asked and `unavailable`
	 * asked and got nothing, so both ask again — which is what makes an outage
	 * during one navigation recoverable by the next one rather than sticky for
	 * the rest of the session.
	 */
	async function ensure(): Promise<AuthSessionStatus> {
		if (status.value === 'signed-in' || status.value === 'signed-out')
			return status.value;

		return load();
	}

	/**
	 * Exchanges a password for a session.
	 *
	 * The address is trimmed because a password manager and a copied invite
	 * both hand over trailing whitespace, and an address that differs from the
	 * stored one only by a space is refused as a wrong password — a refusal the
	 * operator cannot see the cause of. The password is passed exactly as
	 * typed: whitespace there is a character of the secret.
	 *
	 * A refusal leaves the status alone rather than writing `signed-out`. The
	 * ask was "is this password right", not "does this browser have a session",
	 * and the second question has not been put.
	 */
	async function signIn(email: string, password: string): Promise<AuthAttempt> {
		try {
			const answer = await authClient.signIn.email({ email: email.trim(), password });

			if (answer.error)
				return { ok: false, message: answer.error.message ?? SIGN_IN_FAILED_MESSAGE };

			// Better Auth answers a successful sign-in with the user it just
			// authenticated, so the session is settled here without a second
			// round trip to ask who we now are — and any read still in the air
			// is now describing a browser that no longer exists.
			sessionReads.supersede();
			user.value = answer.data?.user ?? null;
			status.value = user.value ? 'signed-in' : 'unknown';
			return { ok: true };
		}
		catch {
			return { ok: false, message: SIGN_IN_FAILED_MESSAGE };
		}
	}

	/**
	 * Ends the session on the server, and only then here.
	 *
	 * A sign-out that did not land leaves the status `unknown` rather than
	 * `signed-out`. Writing `signed-out` locally would show an operator a
	 * signed-out shell over a session that is still live and still accepted by
	 * every API call the page makes — the worst of both readings. `unknown`
	 * says what is true, and the next navigation asks the server which it is.
	 */
	async function signOut(): Promise<AuthAttempt> {
		try {
			const answer = await authClient.signOut();
			sessionReads.supersede();

			if (answer.error) {
				status.value = 'unknown';
				return { ok: false, message: answer.error.message ?? SIGN_OUT_FAILED_MESSAGE };
			}

			user.value = null;
			status.value = 'signed-out';
			return { ok: true };
		}
		catch {
			sessionReads.supersede();
			status.value = 'unknown';
			return { ok: false, message: SIGN_OUT_FAILED_MESSAGE };
		}
	}

	return {
		status: readonly(status),
		user: readonly(user),
		load,
		ensure,
		signIn,
		signOut,
	};
}
