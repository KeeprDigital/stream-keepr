import type {
	GraphicsAuthoringLeaseOutcome,
	GraphicsAuthoringLeaseReading,
} from '~~/shared/modules/graphics-authoring-lease';
import { GRAPHICS_AUTHORING_LEASE_DEFAULT_HEARTBEAT_MS } from '~~/shared/modules/graphics-authoring-lease';

/**
 * One editor session's Graphics Authoring Lease on the artifact it has open.
 *
 * The composable exists to answer one question the editor asks constantly — may
 * I write this? — and it answers `false` until the server has said otherwise.
 * Failing closed matters: an observer that assumed it could write while its first
 * request was in flight is exactly the corruption the lease prevents.
 *
 * It asks the same endpoint on a fixed cadence, which is both the holder's
 * heartbeat and an observer's chance of promotion. That single loop is why an
 * abandoned artifact needs no notification to be recovered: the observer's next
 * ask lands after the vanished holder's deadline and is granted.
 */

export interface UseGraphicsAuthoringLeaseOptions {
	/** The lease endpoint of one graphics authoring artifact. */
	endpoint: MaybeRefOrGetter<string>;
	/** Ask only while the artifact is actually open for authoring. */
	enabled?: MaybeRefOrGetter<boolean>;
}

export type GraphicsAuthoringLeaseStatus = 'idle' | 'pending' | 'ready' | 'error';

interface LeaseEnvelope {
	lease: GraphicsAuthoringLeaseReading;
	outcome?: GraphicsAuthoringLeaseOutcome;
}

export function useGraphicsAuthoringLease(options: UseGraphicsAuthoringLeaseOptions) {
	const lease = ref<GraphicsAuthoringLeaseReading | null>(null);
	const status = ref<GraphicsAuthoringLeaseStatus>('idle');
	const enabled = computed(() => toValue(options.enabled ?? true));
	const endpoint = computed(() => toValue(options.endpoint));

	/** Only a confirmed held lease authorises an authoring write. */
	const writable = computed(() => status.value === 'ready' && (lease.value?.writable ?? false));
	const heldByAnotherSession = computed(() => lease.value?.heldByAnotherSession ?? false);
	const canTakeOver = computed(() => status.value === 'ready' && heldByAnotherSession.value);
	/**
	 * Who is holding it, where the server could resolve their session to a person
	 * (#398). Read from the last answer rather than remembered: a holder can be
	 * displaced between heartbeats, and a stale name beside a live lease would say
	 * an operator is editing something they have already left.
	 */
	const holderName = computed(() => lease.value?.holderName ?? null);

	async function ask(body: { takeover?: boolean } = {}): Promise<void> {
		if (!enabled.value)
			return;
		const asked = endpoint.value;
		if (status.value === 'idle')
			status.value = 'pending';
		try {
			const response = await $fetch<LeaseEnvelope>(asked, {
				method: 'POST',
				body: { ...body, heartbeatIntervalMs: GRAPHICS_AUTHORING_LEASE_DEFAULT_HEARTBEAT_MS },
			});
			// A different artifact was opened while this was in flight; its own ask owns
			// the answer.
			if (asked !== endpoint.value)
				return;
			lease.value = response.lease;
			status.value = 'ready';
		}
		catch {
			if (asked !== endpoint.value)
				return;
			lease.value = null;
			status.value = 'error';
		}
	}

	/** Displace the current holder, deliberately and on an author's instruction. */
	async function takeOver(): Promise<void> {
		await ask({ takeover: true });
	}

	async function release(target = endpoint.value): Promise<void> {
		if (!lease.value || lease.value.role !== 'holder')
			return;
		lease.value = null;
		status.value = 'idle';
		try {
			await $fetch(target, { method: 'DELETE' });
		}
		catch {
			// A lease nobody releases still expires; there is nothing to recover here.
		}
	}

	const { pause, resume } = useIntervalFn(
		() => void ask(),
		GRAPHICS_AUTHORING_LEASE_DEFAULT_HEARTBEAT_MS,
		{ immediate: false },
	);

	watch([enabled, endpoint], ([isEnabled], previous) => {
		const previousEndpoint = previous?.[1];
		if (previousEndpoint && previousEndpoint !== endpoint.value)
			void release(previousEndpoint);

		if (!isEnabled) {
			pause();
			void release();
			status.value = 'idle';
			return;
		}
		void ask();
		resume();
	}, { immediate: true });

	// A closing tab releases its lease so the next author does not wait out a
	// deadline. `keepalive` is what lets the request outlive the page; the deadline
	// is what covers every close that never gets here at all.
	if (import.meta.client) {
		useEventListener(window, 'pagehide', () => {
			if (lease.value?.role !== 'holder')
				return;
			void fetch(endpoint.value, { method: 'DELETE', keepalive: true }).catch(() => {});
		});

		// Browsers throttle timers in a hidden tab — potentially to about once a
		// minute, which is the deadline itself — so a holder that tabs away can lose
		// its lease to a waiting observer. Asking again the moment the tab comes back
		// both renews a lease that survived and discovers one that did not, before the
		// author touches anything.
		useEventListener(document, 'visibilitychange', () => {
			if (document.visibilityState === 'visible')
				void ask();
		});
	}

	onScopeDispose(() => {
		pause();
		void release();
	});

	return { lease, status, writable, heldByAnotherSession, holderName, canTakeOver, refresh: ask, takeOver, release };
}
