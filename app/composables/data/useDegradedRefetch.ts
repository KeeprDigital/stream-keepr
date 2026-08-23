import type { Ref } from 'vue';
import type { Flight } from '~/utils/guardedSequence';
import { readonly, ref } from 'vue';
import { DECK_CARD_DATA_REFETCH_MS } from '~/composables/data/useScryfallBatch';

export interface DegradedRefetchOptions<TSource> {
	/**
	 * Re-run the surface's load silently. Fired on the shared
	 * `DECK_CARD_DATA_REFETCH_MS` cadence while the surface is degraded.
	 */
	refetch: () => void;
	/**
	 * Whether a freshly built source is the same one the current rendering was
	 * built from. Identity is the consumer's: the Deck Screen Mode compares a
	 * source-freshness stamp against what is on program, the card-screen
	 * surfaces compare deck-response object identity (#465 review, #471).
	 */
	isUnchanged: (next: TSource) => boolean;
	/** Called whenever the degraded flag changes hands, e.g. to mirror it into a Screen's card-data health report. */
	report?: (degraded: boolean) => void;
}

export interface DegradedRefetch<TSource> {
	/** True while this surface renders placeholders it should not be (#465). */
	degraded: Readonly<Ref<boolean>>;
	/**
	 * Start a load: supersedes any in-flight load and cancels a pending
	 * re-fetch (a degraded completion schedules the next one itself). Returns
	 * the load's Flight, checked for staleness after each await.
	 */
	begin: () => Flight;
	/**
	 * Record a completed build. While degraded, arms the next re-fetch and
	 * answers whether the current rendering should be kept: a still-degraded
	 * rebuild of an unchanged source has nothing better to show than the
	 * identical placeholder rendering already up (#465 review).
	 */
	completeLoad: (degraded: boolean, next: TSource) => 'keep' | 'render';
	/**
	 * A failed or empty attempt must not end a degraded rendering's recovery
	 * cadence — the source endpoint failing during the same outage would
	 * otherwise leave the degradation permanent (#465 review). Returns whether
	 * the cadence was kept (i.e. the surface is degraded).
	 */
	keepCadence: () => boolean;
	/**
	 * Settle the lifecycle when the surface clears: a degraded report must not
	 * outlive the rendering that measured it, and a cleared surface has nothing
	 * left to re-fetch.
	 */
	settle: () => void;
	/** Cancel a pending re-fetch without settling — teardown that must not touch the degraded flag. */
	cancel: () => void;
}

/**
 * The reload-free degraded-recovery lifecycle shared by every surface that
 * renders Scryfall-enriched deck data (#465, #471, extracted by #472):
 * supersede via Guarded Sequence, a slow re-fetch cadence while degraded,
 * keep-on-unchanged, keep-cadence-on-failure, and a settle on clear. What
 * varies per surface stays outside: source identity, health reporting, and
 * what a failed load does to the rendering.
 */
export function useDegradedRefetch<TSource>(
	options: DegradedRefetchOptions<TSource>,
): DegradedRefetch<TSource> {
	const degraded = ref(false);
	const loads = createGuardedSequence();
	let timer: ReturnType<typeof setTimeout> | null = null;

	function cancel() {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
	}

	function schedule() {
		cancel();
		timer = setTimeout(() => {
			timer = null;
			options.refetch();
		}, DECK_CARD_DATA_REFETCH_MS);
	}

	function setDegraded(next: boolean) {
		degraded.value = next;
		options.report?.(next);
	}

	function begin(): Flight {
		cancel();
		return loads.begin();
	}

	function completeLoad(nowDegraded: boolean, next: TSource): 'keep' | 'render' {
		setDegraded(nowDegraded);
		if (!nowDegraded) {
			return 'render';
		}
		schedule();
		return options.isUnchanged(next) ? 'keep' : 'render';
	}

	function keepCadence(): boolean {
		if (!degraded.value) {
			return false;
		}
		schedule();
		return true;
	}

	function settle() {
		cancel();
		loads.supersede();
		setDegraded(false);
	}

	return {
		degraded: readonly(degraded),
		begin,
		completeLoad,
		keepCadence,
		settle,
		cancel,
	};
}
