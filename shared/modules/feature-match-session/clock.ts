export {
	applyClockAdjustment,
	clockTransitions,
	formatClockTime,
	getEffectiveElapsedMs,
	minutesToMs,
	normalizeTimeInput,
	parseTimeInput,
	readStoredClock,
	writeStoredClock,
} from '~~/shared/utils/clock';

export type { ClockAdjustmentInput, FeatureMatchClock } from '~~/shared/utils/clock';
