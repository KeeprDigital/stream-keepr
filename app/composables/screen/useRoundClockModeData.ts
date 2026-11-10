import type { ScreenOutputRoundClockResponse } from '~~/shared/types/screenOutputReads';
import type { ScreenContext } from '~/composables/screen/useScreenContext';
import { projectRoundClock } from '~~/shared/utils/roundClock';
import { useScreenModeFreshness } from '~/modules/screen-mode/freshness';
import { useScreenModeHearing } from '~/modules/screen-mode/hearing';

const NO_ROUND: ScreenOutputRoundClockResponse = { round: null };

/** The longest one timer waits; a start further off is waited for in steps of it. */
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

/**
 * What a Round Clock Screen renders: its Round, read through the Screen and kept
 * current by Screen Mode Data Freshness, and that Round's clock projected from
 * server time (ADR-0066). The clock re-evaluates exactly when it next changes;
 * nothing writes as it runs or when it runs out.
 */
export function useRoundClockModeData(context: ScreenContext) {
	const config = useScreenModeConfig(context, 'round-clock');
	const outputReads = useScreenOutputReads(context);
	const { getServerTime, serverTimeOffset } = useServerTime();

	const freshness = useScreenModeFreshness<ScreenOutputRoundClockResponse>({
		hearing: useScreenModeHearing(context, 'round-clock', () => config.value),
		source: () => outputReads.scopeKey.value
			? `${outputReads.scopeKey.value}:${config.value.roundId ?? 'current'}`
			: null,
		read: () => outputReads.roundClock(),
		initialData: NO_ROUND,
		errorMessage: 'Failed to load the Round',
	});
	const round = computed(() => freshness.data.value.round);

	/** Advanced when the clock next changes, or when the shared clock re-syncs. */
	const tick = ref(0);
	watch(serverTimeOffset, () => tick.value++);

	const clock = computed(() => {
		void tick.value;
		const held = round.value;
		return projectRoundClock({
			startedAt: held?.startedAt
				? Date.parse(held.startedAt)
				: null,
			durationMinutes: held?.durationMinutes ?? null,
		}, getServerTime(), {
			enabled: config.value.countUpAfterEnd,
			limitMinutes: config.value.countUpLimitMinutes ?? null,
		});
	});

	// Each projection is a new value, so every tick schedules the next.
	watch(clock, ({ nextChangeInMs: delay }, _previous, onCleanup) => {
		if (delay == null)
			return;
		const timer = setTimeout(() => tick.value++, Math.min(delay, MAX_TIMER_DELAY_MS));
		onCleanup(() => clearTimeout(timer));
	}, { immediate: true });

	const isEmpty = computed(() => freshness.answered.value && !round.value);

	return {
		/** Rendering Readiness: its first read has answered or failed. */
		ready: freshness.answered,
		config,
		loading: freshness.loading,
		error: freshness.error,
		isEmpty,
		round,
		clock,
	};
}
