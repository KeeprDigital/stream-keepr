import type { MaybeRefOrGetter } from 'vue';
import type { PlayerDisplayConfig } from '~/types';

/**
 * Resolves PlayerDisplayConfig fields into individual computed refs
 * with centralised defaults. Used by both the admin PlayerControls
 * and the screen-overlay PlayerSide so defaults are defined once.
 *
 * `defaultSeatLabel` is an optional fallback sourced from
 * usePlayerFeatureMatchData (orientation-derived), overridden when the
 * config carries an explicit seatLabel (e.g. screen path's
 * Left/Right labels).
 */
export function usePlayerDisplayConfig(
	config: MaybeRefOrGetter<PlayerDisplayConfig | undefined>,
	defaultSeatLabel?: MaybeRefOrGetter<string | undefined>,
) {
	const cfg = () => toValue(config);

	return {
		// Display toggles
		showName: computed(() => cfg()?.showName ?? true),
		showPronouns: computed(() => cfg()?.showPronouns ?? true),
		showDeckName: computed(() => cfg()?.showDeckName ?? true),
		showCounters: computed(() => cfg()?.showCounters ?? true),
		showRecord: computed(() => cfg()?.showRecord ?? false),
		showLgs: computed(() => cfg()?.showLgs ?? false),
		showMulliganInfo: computed(() => cfg()?.showMulliganInfo ?? true),

		// Permission flags (screen path)
		allowLifeControls: computed(() => cfg()?.allowLifeControls ?? true),
		allowGameWinControls: computed(() => cfg()?.allowGameWinControls ?? true),
		allowCounterControls: computed(() => cfg()?.allowCounterControls ?? true),

		// Game phase state
		mulliganPhase: computed(() => cfg()?.mulliganPhase ?? false),
		startingHandSize: computed(() => cfg()?.startingHandSize ?? 7),
		activePlayerTrackingEnabled: computed(() => cfg()?.activePlayerTrackingEnabled ?? false),

		// Context-dependent overrides
		hasDeckList: computed(() => cfg()?.hasDeckList ?? false),
		seatLabel: computed(() => cfg()?.seatLabel ?? toValue(defaultSeatLabel)),
	};
}
