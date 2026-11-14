const SYNC_INTERVAL = 60 * 1000; // Re-sync every 60 seconds
const SAMPLE_COUNT = 3; // Samples per sync; the one with the shortest round trip is taken
const SAMPLE_DELAY_MS = 50;
const REQUEST_TIMEOUT_MS = 3000;
/** A round trip bounds its offset's error to half of itself; above this it is too loose to trust. */
const MAX_SAMPLE_RTT_MS = 1000;
/** A correction larger than this is applied at once; one up to it is eased in (ADR-0088). */
const STEP_CORRECTION_THRESHOLD_MS = 500;
/** The most of elapsed time an eased correction may add or take, so server time always advances. */
const MAX_EASE_RATE = 0.1;
/** Below this a device wait's fraction is arithmetic error, not time to round up. */
const EASE_ROUNDING_MS = 1e-6;
/** A re-sync asked for by the page coming back is skipped this soon after a sync. */
const RESYNC_MIN_GAP_MS = 5000;
/** How often the device's clock is compared with its monotonic clock. */
const CLOCK_CHECK_INTERVAL_MS = 1000;
/** A device clock moved by more than this since its offset was taken is wrong on air, as a correction over it is. */
const CLOCK_CHANGE_THRESHOLD_MS = STEP_CORRECTION_THRESHOLD_MS;
const TIME_ENDPOINT = '/api/time';

/** A correction being eased in: from the offset `from`, applied since device time `startedAt`. */
interface EasedCorrection {
	from: number;
	startedAt: number;
}

let globalSyncActive = false;
let syncIntervalId: ReturnType<typeof setInterval> | null = null;
let correctionEndId: ReturnType<typeof setTimeout> | null = null;
let syncsInFlight = 0;
let stopReturnListeners: (() => void) | null = null;
let clockCheckId: ReturnType<typeof setInterval> | null = null;
/** The device's clock and its monotonic clock as the sync that took the offset held began; null before one. */
let offsetTakenAt: { device: number; monotonic: number } | null = null;
/** The monotonic clock as the last sync began. */
let lastSyncBeganAt: number | null = null;

export function useServerTime() {
	const serverTimeOffset = useState<number>('serverTimeOffset', () => 0);
	const isSynced = useState<boolean>('serverTimeSynced', () => false);
	const hasWarned = useState<boolean>('serverTimeSyncWarned', () => false);
	const lastSyncedAt = useState<number | null>('serverTimeLastSyncedAt', () => null);
	/** Null once `serverTimeOffset` is applied in full. */
	const correction = useState<EasedCorrection | null>('serverTimeCorrection', () => null);

	/** The offset server time is read at now: `serverTimeOffset`, less what a correction has yet to ease in. */
	function appliedOffset(): number {
		const target = serverTimeOffset.value;
		const easing = correction.value;
		if (!easing)
			return target;
		const eased = Math.max(0, Date.now() - easing.startedAt) * MAX_EASE_RATE;
		const remaining = target - easing.from;
		return Math.abs(remaining) <= eased
			? target
			: easing.from + Math.sign(remaining) * eased;
	}

	/**
	 * Take a sync's offset. The first, and a correction over the threshold, is
	 * applied at once; a smaller one is eased in from the offset now applied, and
	 * `correction` clears as it completes so reactive readers of server time read
	 * it again.
	 */
	function applyOffset(offset: number) {
		const from = appliedOffset();
		if (correctionEndId !== null) {
			clearTimeout(correctionEndId);
			correctionEndId = null;
		}

		const size = Math.abs(offset - from);
		const eases = isSynced.value && size > 0 && size <= STEP_CORRECTION_THRESHOLD_MS;
		correction.value = eases
			? {
					from,
					startedAt: Date.now(),
				}
			: null;
		serverTimeOffset.value = offset;

		if (eases) {
			correctionEndId = setTimeout(() => {
				correctionEndId = null;
				correction.value = null;
			}, Math.ceil(size / MAX_EASE_RATE));
		}
	}

	/**
	 * Fetch a single time sample with RTT compensation
	 */
	async function fetchTimeSample(): Promise<{ offset: number; rtt: number }> {
		const clientSendTime = Date.now();
		const response = await $fetch<{ serverTime: number }>(TIME_ENDPOINT, {
			// One request per sample: a retry would count the failed attempt as latency.
			retry: 0,
			timeout: REQUEST_TIMEOUT_MS,
		});
		const clientReceiveTime = Date.now();

		const rtt = clientReceiveTime - clientSendTime;
		// Estimate server time at the midpoint of the request
		const estimatedServerTime = response.serverTime + rtt / 2;
		const offset = estimatedServerTime - clientReceiveTime;

		return { offset, rtt };
	}

	/**
	 * Perform time synchronization with multiple samples
	 */
	async function sync(): Promise<void> {
		syncsInFlight++;
		const began = {
			device: Date.now(),
			monotonic: performance.now(),
		};
		lastSyncBeganAt = began.monotonic;
		try {
			const samples: { offset: number; rtt: number }[] = [];

			// Collect samples
			for (let i = 0; i < SAMPLE_COUNT; i++) {
				try {
					const sample = await fetchTimeSample();
					samples.push(sample);
				}
				catch {
					// Ignore individual sample failures
				}
				// Small delay between samples
				if (i < SAMPLE_COUNT - 1) {
					await new Promise(resolve => setTimeout(resolve, SAMPLE_DELAY_MS));
				}
			}

			// A slow sample would replace a good offset with a loose one, so it counts
			// only while no offset is held, when it still beats an unknown clock.
			const trusted = samples.filter(sample => sample.rtt <= MAX_SAMPLE_RTT_MS);
			const usable = trusted.length > 0 || isSynced.value
				? trusted
				: samples;

			// A round trip bounds its sample's error to half of itself, so the
			// shortest is the best estimate; averaging would only add the others' error.
			const [best] = usable.toSorted((a, b) => a.rtt - b.rtt);

			if (!best) {
				// `isSynced` says an offset is held, not that the last sync answered:
				// consumers read `false` as an unknown clock, and a missed re-sync
				// leaves the offset already held as good as it was.
				if (!hasWarned.value) {
					console.warn('Server time sync unavailable; keeping the last known offset until the API responds.');
					hasWarned.value = true;
				}
				return;
			}

			applyOffset(best.offset);
			offsetTakenAt = began;
			isSynced.value = true;
			hasWarned.value = false;
			lastSyncedAt.value = Date.now();
		}
		catch {
			if (!hasWarned.value) {
				console.warn('Server time sync failed; keeping the last known offset until the API responds.');
				hasWarned.value = true;
			}
		}
		finally {
			syncsInFlight--;
		}
	}

	/**
	 * Get the current estimated server time
	 */
	function getServerTime(): number {
		return Date.now() + appliedOffset();
	}

	/**
	 * How long on the device's clock until server time, as read, has advanced by
	 * `serverMs`. While a correction is eased in server time runs faster or
	 * slower than the device's, so a wait for it is shorter or longer by what the
	 * correction applies within it (ADR-0088). To the whole millisecond above,
	 * so a timer set for it never ends before server time is there.
	 */
	function deviceDelayFor(serverMs: number): number {
		const remaining = serverTimeOffset.value - appliedOffset();
		if (remaining === 0)
			return serverMs;
		const rate = 1 + Math.sign(remaining) * MAX_EASE_RATE;
		const easedServerMs = Math.abs(remaining) / MAX_EASE_RATE * rate;
		const deviceMs = serverMs <= easedServerMs
			? serverMs / rate
			: serverMs - remaining;
		return Math.ceil(deviceMs - EASE_ROUNDING_MS);
	}

	/**
	 * Re-sync because the page is back, a hidden tab's timers having been
	 * throttled and an offline device's syncs unanswered, or because the device's
	 * clock was changed. Skipped while a sync is running or just after one. A last
	 * sync in the device's future means its clock was set back, which is itself a
	 * reason to sync.
	 */
	function resyncUnlessRecent() {
		const sinceLastSync = lastSyncedAt.value === null
			? null
			: Date.now() - lastSyncedAt.value;
		const justSynced = sinceLastSync !== null && sinceLastSync >= 0 && sinceLastSync < RESYNC_MIN_GAP_MS;
		if (syncsInFlight > 0 || justSynced)
			return;
		void sync();
	}

	function resyncWhenVisible() {
		if (document.visibilityState === 'visible')
			resyncUnlessRecent();
	}

	/**
	 * Re-sync when the device's clock has been changed: it has moved away from the
	 * monotonic clock since the offset held was taken. Measured from then, not
	 * from the last check, so a change stands until a sync answers it: one the
	 * gap skips, or one whose re-sync goes unanswered, is asked about again, no
	 * sooner than the gap after the last sync began.
	 */
	function resyncOnClockChange() {
		if (offsetTakenAt === null)
			return;
		const monotonicNow = performance.now();
		const deviceElapsed = Date.now() - offsetTakenAt.device;
		const monotonicElapsed = monotonicNow - offsetTakenAt.monotonic;
		if (Math.abs(deviceElapsed - monotonicElapsed) <= CLOCK_CHANGE_THRESHOLD_MS)
			return;
		if (lastSyncBeganAt !== null && monotonicNow - lastSyncBeganAt < RESYNC_MIN_GAP_MS)
			return;
		resyncUnlessRecent();
	}

	/**
	 * Start periodic synchronization
	 */
	function startSync() {
		if (globalSyncActive)
			return;

		globalSyncActive = true;

		// Initial sync
		void sync();

		// Periodic re-sync
		syncIntervalId = setInterval(sync, SYNC_INTERVAL);
		// A visible, online tab gets no event when its device's clock is changed.
		clockCheckId = setInterval(resyncOnClockChange, CLOCK_CHECK_INTERVAL_MS);

		// Held by the page, not by the scope of whichever consumer started the sync.
		document.addEventListener('visibilitychange', resyncWhenVisible);
		window.addEventListener('online', resyncUnlessRecent);
		stopReturnListeners = () => {
			document.removeEventListener('visibilitychange', resyncWhenVisible);
			window.removeEventListener('online', resyncUnlessRecent);
		};
	}

	/**
	 * Stop periodic synchronization and reset the singleton so a later
	 * `startSync()` call (e.g. after HMR) can start it again cleanly.
	 */
	function stopSync() {
		if (syncIntervalId !== null) {
			clearInterval(syncIntervalId);
			syncIntervalId = null;
		}
		if (clockCheckId !== null) {
			clearInterval(clockCheckId);
			clockCheckId = null;
		}
		stopReturnListeners?.();
		stopReturnListeners = null;
		globalSyncActive = false;
	}

	// Auto-start on client side (lazy singleton — first consumer triggers sync)
	if (import.meta.client && !globalSyncActive) {
		startSync();
		// `pagehide`, not `beforeunload`, which also fires for an unload the operator cancels.
		window.addEventListener('pagehide', stopSync, { once: true });
		import.meta.hot?.dispose(() => stopSync());
	}

	return {
		serverTimeOffset: readonly(serverTimeOffset),
		isSynced: readonly(isSynced),
		lastSyncedAt: readonly(lastSyncedAt),
		getServerTime,
		deviceDelayFor,
		sync,
		startSync,
		stopSync,
	};
}
