import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import type { ScreenOutputFeatureMatchResponse } from '~~/shared/types/screenOutputReads';
import type { ScreenModeDependencies } from '~/modules/screen-mode/freshness';
import type { FeatureMatch } from '~/types';
import { useScreenModeFreshness } from '~/modules/screen-mode/freshness';

interface ScreenFeatureMatchSlotOptions<T> {
	/** The Slot the mode shows; `null` while it shows none. */
	slotId: () => number | null;
	/** What the mode keeps of a Slot read besides the Slot and its Session, which the stores hold. */
	project: (read: ScreenOutputFeatureMatchResponse) => T;
	initialData: T;
	errorMessage: string;
	/** The Event Data what `project` keeps depends on. The Slot and its Session follow on their own. */
	dependsOn?: ScreenModeDependencies<T>;
}

/**
 * The Feature Match Slot a Feature Match or Feature Match Overlay Screen Mode
 * shows, and its Feature Match Session, followed on a Screen Output (#592).
 *
 * Two modules own the two halves, so neither mode writes either again:
 *
 * - Screen Mode Data Freshness owns when the Slot is read through its Screen:
 *   on selection, on the degraded cadence, and on Reconnect Resync. One read
 *   answers the Slot, its Session and the Match it follows, so a resync finds
 *   a promotion missed in an outage as well as a score.
 * - The Live State Follower owns whether what arrives moves the Session held.
 *   A read's Session is offered to it and held only when not behind, so an
 *   older sequence or epoch never replaces a newer one, however late it lands.
 *
 * A gap in the Session's notifications reloads through the Screen as well: the
 * store's reader is installed here for as long as the rendering lives.
 */
export function useScreenFeatureMatchSlot<T>(options: ScreenFeatureMatchSlotOptions<T>) {
	const { eventId } = useScreenContext();
	const featureMatchStore = useFeatureMatchStore();
	const featureMatchStateStore = useFeatureMatchStateStore();
	const outputReads = useScreenOutputReads();
	onScopeDispose(featureMatchStateStore.readSessionsAsScreenOutput(outputReads.featureMatchSession));

	const freshness = useScreenModeFreshness<T>({
		eventId,
		source: () => {
			const slotId = options.slotId();
			return outputReads.scopeKey.value && slotId ? `${outputReads.scopeKey.value}:${slotId}` : null;
		},
		read: async (): Promise<T> => {
			const read = await outputReads.featureMatchSlot(options.slotId()!);
			// A Slot read before a newer promotion or clearing is left behind whole,
			// so nothing it says replaces what is shown.
			if (!featureMatchStore.holdFeatureMatch(read.slot))
				return freshness.data.value;
			return options.project(read);
		},
		initialData: options.initialData,
		errorMessage: options.errorMessage,
		dependsOn: options.dependsOn ?? {},
	});

	const slot = computed<FeatureMatch | null>(() => {
		const slotId = options.slotId();
		return slotId ? featureMatchStore.featureMatches.find(held => held.id === slotId) ?? null : null;
	});

	const state = computed<FeatureMatchState | null>(() => {
		const slotId = options.slotId();
		return slotId ? featureMatchStateStore.featureMatchStates.get(slotId) ?? null : null;
	});

	return {
		slot,
		state,
		data: freshness.data,
		loading: freshness.loading,
		error: freshness.error,
	};
}
