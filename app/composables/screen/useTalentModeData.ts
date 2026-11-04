import type { SocialProfileProjectionValue } from '~~/shared/types/graphics';
import type { ScreenOutputTalent, ScreenOutputTalentResponse } from '~~/shared/types/screenOutputReads';
import type { ScreenContext } from '~/composables/screen/useScreenContext';
import type { ScreenModeDependencies } from '~/modules/screen-mode/freshness';
import { msUntilNextTalentScreenProfile, projectTalentScreenSocialProfile } from '~~/shared/modules/talent-screen';
import { talentScreenTalentIds } from '~~/shared/screenModeConfigs/talent';
import { useScreenModeFreshness } from '~/modules/screen-mode/freshness';

/** One shown Talent, with the Social Profiles it shows now: all of them, or the rotation's current one. */
export interface ShownTalent extends ScreenOutputTalent {
	shownProfiles: SocialProfileProjectionValue[];
}

/** A Talent Screen reads its Talents, so an edit or delete of one it shows re-reads (#782). */
function talentDependencies(shows: (talentId: number) => boolean): ScreenModeDependencies<ScreenOutputTalentResponse> {
	return {
		'talent:updated': ({ talent }) => shows(talent.id),
		'talent:deleted': ({ talentId }) => shows(talentId),
	};
}

/**
 * The step of a running Social Profile Rotation: the synchronized server instant,
 * re-read exactly at each step boundary rather than polled (ADR-0009). Undefined
 * while not rotating or while server time is unknown, which shows the first profile.
 */
function useRotationInstant(rotating: () => boolean, dwellMs: () => number) {
	const { isSynced, serverTimeOffset, getServerTime } = useServerTime();
	const tick = ref(0);

	if (import.meta.client) {
		watchEffect((onCleanup) => {
			if (!rotating() || !isSynced.value)
				return;
			void tick.value;
			void serverTimeOffset.value;
			const timer = setTimeout(() => {
				tick.value++;
			}, msUntilNextTalentScreenProfile({
				dwellMs: dwellMs(),
				now: getServerTime(),
			}));
			onCleanup(() => clearTimeout(timer));
		});
	}

	return computed<number | undefined>(() => {
		if (!rotating() || !isSynced.value)
			return undefined;
		void tick.value;
		void serverTimeOffset.value;
		return getServerTime();
	});
}

/**
 * A Talent Screen's Talents, kept current on a Screen Output (#782): one Talent
 * or a lineup, each with its role, photo and the Social Profiles it shows.
 */
export function useTalentModeData(context: ScreenContext) {
	const { eventId } = context;
	const config = useScreenModeConfig(context, 'talent');
	const outputReads = useScreenOutputReads(context);
	const shownIds = computed(() => talentScreenTalentIds(config.value));

	const freshness = useScreenModeFreshness<ScreenOutputTalentResponse>({
		eventId,
		source: () => {
			const ids = shownIds.value;
			if (!outputReads.scopeKey.value || ids.length === 0)
				return null;
			// What the server derives the answer from: the Talents, and what it shows of each.
			return [
				outputReads.scopeKey.value,
				ids.join(','),
				config.value.socialNetworks.join(','),
				config.value.showPhoto,
			].join(':');
		},
		read: () => outputReads.talent(),
		initialData: { talents: [] },
		errorMessage: 'Failed to load Talent',
		dependsOn: talentDependencies(talentId => shownIds.value.includes(talentId)),
	});

	const rotationInstant = useRotationInstant(
		() => config.value.rotateSocialProfiles,
		() => config.value.socialProfileDwellMs,
	);

	const talents = computed<ShownTalent[]>(() => freshness.data.value.talents.map(talent => ({
		...talent,
		shownProfiles: config.value.rotateSocialProfiles
			? [
					projectTalentScreenSocialProfile(talent.socialProfiles, {
						dwellMs: config.value.socialProfileDwellMs,
						now: rotationInstant.value,
					}),
				].filter(shown => shown !== undefined)
			: talent.socialProfiles,
	})));

	const headerText = computed(() => config.value.headerText || 'On the Desk');
	/** Nothing is selected, or every Talent selected is gone. */
	const isEmpty = computed(() => shownIds.value.length === 0 || (freshness.answered.value && talents.value.length === 0));

	return {
		/** Rendering Readiness: its first read has answered or failed. */
		ready: freshness.answered,
		config,
		loading: freshness.loading,
		error: freshness.error,
		isEmpty,
		headerText,
		talents,
	};
}
