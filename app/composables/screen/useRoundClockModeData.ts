import type { ScreenOutputRoundClockResponse } from '~~/shared/types/screenOutputReads';
import type { ScreenContext } from '~/composables/screen/useScreenContext';
import type { ScreenModeDependencies } from '~/modules/screen-mode/freshness';
import { projectRoundClock } from '~~/shared/utils/roundClock';
import { useScreenModeFreshness } from '~/modules/screen-mode/freshness';

const NO_ROUND: ScreenOutputRoundClockResponse = { round: null };

/** The longest one timer waits; a start further off is waited for in steps of it. */
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

/**
 * The Event Data a Round Clock is read from. A picked Round re-reads on its own
 * update. The Current Round can move with any Round, Phase, Match or Melee
 * pairing, so following it re-reads on each. Melee's wholesale syncs re-read either way.
 */
function roundClockDependencies(roundId: () => number | undefined): ScreenModeDependencies<ScreenOutputRoundClockResponse> {
	const follows = (id: number, held: ScreenOutputRoundClockResponse) => roundId() == null || id === roundId() || id === held.round?.id;
	const followsCurrent = () => roundId() == null;

	return {
		'round:created': followsCurrent,
		'round:updated': ({ round }, held) => follows(round.id, held),
		'round:deleted': ({ roundId: id }, held) => follows(id, held),
		'round:matchesRefreshed': followsCurrent,
		'match:created': followsCurrent,
		'match:deleted': followsCurrent,
		'phase:updated': followsCurrent,
		'phase:deleted': followsCurrent,
		'melee:pairingsSynced': followsCurrent,
		'melee:dataReset': true,
		'melee:structureSynced': true,
	};
}

/**
 * What a Round Clock Screen renders: its Round, read through the Screen and kept
 * current by Screen Mode Data Freshness, and that Round's clock projected from
 * server time (ADR-0066). The clock re-evaluates exactly when it next changes;
 * nothing writes as it runs or when it runs out.
 */
export function useRoundClockModeData(context: ScreenContext) {
	const { eventId } = context;
	const config = useScreenModeConfig(context, 'round-clock');
	const outputReads = useScreenOutputReads(context);
	const { getServerTime, serverTimeOffset } = useServerTime();

	const freshness = useScreenModeFreshness<ScreenOutputRoundClockResponse>({
		eventId,
		source: () => outputReads.scopeKey.value
			? `${outputReads.scopeKey.value}:${config.value.roundId ?? 'current'}`
			: null,
		read: () => outputReads.roundClock(),
		initialData: NO_ROUND,
		errorMessage: 'Failed to load the Round',
		dependsOn: roundClockDependencies(() => config.value.roundId),
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
		}, getServerTime());
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
