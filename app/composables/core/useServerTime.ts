const SYNC_INTERVAL = 60 * 1000; // Re-sync every 60 seconds
const SAMPLE_COUNT = 3; // Number of samples to average
const SAMPLE_DELAY_MS = 50;
const REQUEST_TIMEOUT_MS = 3000;
/** A round trip bounds its offset's error to half of itself; above this it is too loose to trust. */
const MAX_SAMPLE_RTT_MS = 1000;
const TIME_ENDPOINT = '/api/time';

let globalSyncActive = false;
let syncIntervalId: ReturnType<typeof setInterval> | null = null;

export function useServerTime() {
	const serverTimeOffset = useState<number>('serverTimeOffset', () => 0);
	const isSynced = useState<boolean>('serverTimeSynced', () => false);
	const hasWarned = useState<boolean>('serverTimeSyncWarned', () => false);
	const lastSyncedAt = useState<number | null>('serverTimeLastSyncedAt', () => null);

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

			if (usable.length === 0) {
				// `isSynced` says an offset is held, not that the last sync answered:
				// consumers read `false` as an unknown clock, and a missed re-sync
				// leaves the offset already held as good as it was.
				if (!hasWarned.value) {
					console.warn('Server time sync unavailable; keeping the last known offset until the API responds.');
					hasWarned.value = true;
				}
				return;
			}

			// Sort by RTT and discard the highest (most affected by network latency)
			usable.sort((a, b) => a.rtt - b.rtt);
			const validSamples = usable.slice(0, Math.max(1, SAMPLE_COUNT - 1));

			// Average the remaining offsets
			const averageOffset = validSamples.reduce((sum, s) => sum + s.offset, 0) / validSamples.length;

			serverTimeOffset.value = averageOffset;
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
	}

	/**
	 * Get the current estimated server time
	 */
	function getServerTime(): number {
		return Date.now() + serverTimeOffset.value;
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
		sync,
		startSync,
		stopSync,
	};
}
