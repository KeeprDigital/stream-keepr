import type { Ref } from 'vue';

/**
 * One administrator-only reading of durable Graphics Asset Library state.
 *
 * Every administrator surface works the same way: hold a token for the session
 * only, take a reading, poll it, and drop the reading the moment the token
 * stops being accepted. Sharing that here keeps the two surfaces agreeing on
 * the parts that are easy to get subtly wrong — what counts as an authorization
 * failure, whether a stale reading may stay on screen, and how hard a library
 * that is down gets asked again.
 */

/** How often a healthy reading is refreshed. */
const POLL_INTERVAL_MILLISECONDS = 5000;

/**
 * How many polling ticks to skip after repeated failures, doubling up to a cap.
 * A library that is down should not be asked every five seconds indefinitely,
 * and the first success resets it, so an intermittent failure costs at most one
 * slower recovery rather than a permanently slower surface.
 */
const MAXIMUM_BACKOFF_TICKS = 12;

export interface GraphicsAdminReading<Reading> {
	administratorToken: Ref<string>;
	reading: Ref<Reading | null>;
	loadPending: Ref<boolean>;
	loadError: Ref<string | null>;
	/** Whether a reading is currently being shown, not whether the token is valid. */
	hasReading: Ref<boolean>;
	administratorHeaders: () => { 'x-graphics-admin-token': string };
	describeFailure: (caught: unknown, fallback: string) => string;
	statusOf: (caught: unknown) => number | undefined;
	isAuthorizationFailure: (caught: unknown) => boolean;
	load: () => Promise<void>;
}

export function useGraphicsAdminReading<Reading>(options: {
	/** Takes one reading with the headers the caller was given. */
	read: (headers: { 'x-graphics-admin-token': string }) => Promise<Reading>;
	/** What to say when the failure carries no message of its own. */
	failureMessage: string;
	/** Cleared alongside the reading when a token stops being accepted. */
	onAuthorizationLost?: () => void;
	/** Run after each successful reading, for state derived from it. */
	onReading?: () => Promise<void> | void;
	/**
	 * Whether polling should hold off. A reading taken while the surface has an
	 * action in flight would race that action's own re-read and could show the
	 * state from before it, so the caller says when it is mid-change.
	 */
	paused?: () => boolean;
}): GraphicsAdminReading<Reading> {
	const administratorToken = ref('');
	const reading = ref<Reading | null>(null) as Ref<Reading | null>;
	const loadPending = ref(false);
	const loadError = ref<string | null>(null);
	const consecutiveFailures = ref(0);

	const hasReading = computed(() => reading.value !== null);

	function administratorHeaders() {
		return { 'x-graphics-admin-token': administratorToken.value };
	}

	function describeFailure(caught: unknown, fallback: string) {
		return caught instanceof Error ? caught.message : fallback;
	}

	function statusOf(caught: unknown) {
		return (caught as { statusCode?: number; status?: number } | null)?.statusCode
			?? (caught as { status?: number } | null)?.status;
	}

	function isAuthorizationFailure(caught: unknown) {
		const status = statusOf(caught);
		return status === 401 || status === 403;
	}

	async function load() {
		loadPending.value = true;
		loadError.value = null;
		try {
			reading.value = await options.read(administratorHeaders());
			consecutiveFailures.value = 0;
			await options.onReading?.();
		}
		catch (caught) {
			consecutiveFailures.value += 1;
			loadError.value = describeFailure(caught, options.failureMessage);
			// A rotated or revoked token must put the token form back rather than
			// leaving a stale reading on screen forever. Keeping the last reading
			// would show an administrator a library state nobody is still checking.
			if (isAuthorizationFailure(caught)) {
				reading.value = null;
				options.onAuthorizationLost?.();
			}
		}
		finally {
			loadPending.value = false;
		}
	}

	let pollHandle: number | undefined;
	let ticksSinceAttempt = 0;

	function backoffTicks() {
		return consecutiveFailures.value === 0
			? 0
			: Math.min(2 ** (consecutiveFailures.value - 1), MAXIMUM_BACKOFF_TICKS);
	}

	onMounted(() => {
		pollHandle = window.setInterval(() => {
			if (!hasReading.value || loadPending.value || options.paused?.())
				return;
			if (ticksSinceAttempt < backoffTicks()) {
				ticksSinceAttempt += 1;
				return;
			}
			ticksSinceAttempt = 0;
			void load();
		}, POLL_INTERVAL_MILLISECONDS);
	});

	onBeforeUnmount(() => {
		if (pollHandle !== undefined)
			window.clearInterval(pollHandle);
	});

	return {
		administratorToken,
		reading,
		loadPending,
		loadError,
		hasReading,
		administratorHeaders,
		describeFailure,
		statusOf,
		isAuthorizationFailure,
		load,
	};
}
