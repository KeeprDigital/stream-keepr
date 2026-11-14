import type { ScreenOutputRoundClockResponse } from '~~/shared/types/screenOutputReads';
import type { ScreenContext } from '~/composables/screen/useScreenContext';
import { minutesToMs } from '~~/shared/utils/clock';
import { projectRoundClock } from '~~/shared/utils/roundClock';
import { useScreenModeFreshness } from '~/modules/screen-mode/freshness';
import { useScreenModeHearing } from '~/modules/screen-mode/hearing';

const NO_ROUND: ScreenOutputRoundClockResponse = { round: null };

/**
 * What a Round Clock Screen renders: its Round, read through the Screen and kept
 * current by Screen Mode Data Freshness, and that Round's clock projected from
 * server time (ADR-0066), re-evaluated exactly when it next changes (ADR-0088);
 * nothing writes as it runs or when it runs out.
 */
export function useRoundClockModeData(context: ScreenContext) {
	const config = useScreenModeConfig(context, 'round-clock');
	const outputReads = useScreenOutputReads(context);

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

	/** An output yet to sync counts on its own time rather than showing nothing. */
	const clock = useClockProjection((serverTime) => {
		const held = round.value;
		return selfTimed(projectRoundClock({
			startedAt: held?.startedAt
				? Date.parse(held.startedAt)
				: null,
			durationMs: held?.durationMinutes == null
				? null
				: minutesToMs(held.durationMinutes),
		}, serverTime, {
			enabled: config.value.countUpAfterEnd,
			limitMs: config.value.countUpLimitMinutes == null
				? null
				: minutesToMs(config.value.countUpLimitMinutes),
		}));
	}, { whileServerTimeUnknown: 'device-time' });

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
