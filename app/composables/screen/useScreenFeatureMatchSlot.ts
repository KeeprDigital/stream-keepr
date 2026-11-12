import type { DeclaredOutputChangeKind } from '~~/shared/screenOutputInterest';
import type { ScreenMode } from '~~/shared/types/enums';
import type { FeatureMatchState } from '~~/shared/types/featureMatchState';
import type { ModeConfigTypeMap } from '~~/shared/types/screenConfig';
import type { ScreenOutputFeatureMatchResponse } from '~~/shared/types/screenOutputReads';
import type { ScreenContext } from '~/composables/screen/useScreenContext';
import type { FeatureMatch } from '~/types';
import { SCREEN_MODES } from '~~/shared/screenModes';
import { useScreenModeFreshness } from '~/modules/screen-mode/freshness';
import { useScreenModeHearing } from '~/modules/screen-mode/hearing';

interface ScreenFeatureMatchSlotOptions<T, M extends ScreenMode> {
	/** The mode showing the Slot, and its configuration in effect: what its read hears is the mode's to declare. */
	mode: M;
	config: () => ModeConfigTypeMap[M];
	/** The Slot the mode shows; `null` while it shows none. */
	slotId: () => number | null;
	/** What the mode keeps of a Slot read besides the Slot and its Session, which the stores hold. */
	keep: (read: ScreenOutputFeatureMatchResponse) => T;
	initialData: T;
	errorMessage: string;
}

/**
 * The Feature Match Slot a Feature Match or Feature Match Overlay Screen Mode
 * shows, and its Feature Match Session, followed on a Screen Output (#592).
 *
 * Two modules own the two halves, so neither mode writes either again:
 *
 * - Screen Mode Data Freshness owns when the Slot is read through its Screen:
 *   on selection, on a change its mode's Screen hears, on the degraded cadence,
 *   and on Reconnect Resync. One read answers the Slot, its Session and the
 *   Match it follows, so a re-read finds a promotion as well as a score. A
 *   live rendering holds no Slot the Event's messages keep current: its Screen's
 *   channel names a Slot change, and the Slot is read again.
 * - The Live State Follower owns whether what arrives moves the Session held.
 *   A read's Session is offered to it and held only when not behind, so an
 *   older sequence or epoch never replaces a newer one, however late it lands.
 *
 * A gap in the Session's notifications reloads through the Screen as well: the
 * store's reader is installed here for as long as the rendering lives.
 */
export function useScreenFeatureMatchSlot<T, M extends ScreenMode = ScreenMode>(context: ScreenContext, options: ScreenFeatureMatchSlotOptions<T, M>) {
	const featureMatchStore = useFeatureMatchStore();
	const featureMatchStateStore = useFeatureMatchStateStore();
	const outputReads = useScreenOutputReads(context);
	onScopeDispose(featureMatchStateStore.readSessionsAsScreenOutput(outputReads.featureMatchSession));

	// The Session's own messages reach the Live State Follower whole on either
	// channel, a Screen's forwarding those of the Slot it shows, so none asks for a read.
	const follows = (Object.keys(SCREEN_MODES[options.mode].outputFollows) as DeclaredOutputChangeKind[])
		.filter(kind => kind !== 'featureMatchSession');

	/** The Slot what is shown was kept from. */
	let keptSlotId: number | null = null;

	const freshness = useScreenModeFreshness<T>({
		hearing: useScreenModeHearing(context, options.mode, options.config, { follows }),
		source: () => {
			const slotId = options.slotId();
			return outputReads.scopeKey.value && slotId
				? `${outputReads.scopeKey.value}:${slotId}`
				: null;
		},
		read: async (): Promise<T> => {
			const slotId = options.slotId()!;
			const read = await outputReads.featureMatchSlot(slotId);
			// A Slot read before a newer promotion or clearing is left behind whole,
			// so nothing it says replaces what is shown — unless what is shown
			// belongs to the Slot this mode has just left.
			if (!featureMatchStore.holdFeatureMatch(read.slot)) {
				return keptSlotId === slotId
					? freshness.data.value
					: options.initialData;
			}
			keptSlotId = slotId;
			return options.keep(read);
		},
		initialData: options.initialData,
		errorMessage: options.errorMessage,
	});

	/** The Slot held, with the Session followed for it: `SwapPlayers` moves only that (ADR-0058). */
	const slot = computed<FeatureMatch | null>(() => {
		const slotId = options.slotId();
		const held = slotId
			? featureMatchStore.featureMatches.find(candidate => candidate.id === slotId) ?? null
			: null;
		return held
			? withFollowedFeatureMatchSession(held, featureMatchStateStore)
			: null;
	});

	const state = computed<FeatureMatchState | null>(() => {
		const slotId = options.slotId();
		return slotId
			? featureMatchStateStore.featureMatchStates.get(slotId) ?? null
			: null;
	});

	return {
		slot,
		state,
		data: freshness.data,
		loading: freshness.loading,
		error: freshness.error,
		answered: freshness.answered,
	};
}
