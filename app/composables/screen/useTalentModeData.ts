import type { SocialProfileProjectionValue } from '~~/shared/types/graphics';
import type { ScreenOutputTalent, ScreenOutputTalentResponse } from '~~/shared/types/screenOutputReads';
import type { ScreenContext } from '~/composables/screen/useScreenContext';
import { msUntilNextTalentScreenProfile, projectTalentScreenSocialProfile } from '~~/shared/modules/talent-screen';
import { TALENT_SCREEN_AUTO_HEADER_TEXT, talentScreenTalentIds } from '~~/shared/screenModeConfigs/talent';
import { useScreenModeFreshness } from '~/modules/screen-mode/freshness';
import { useScreenModeHearing } from '~/modules/screen-mode/hearing';

/** One shown Talent, with the Social Profiles it shows now: all of them, or the rotation's current one. */
export interface ShownTalent extends ScreenOutputTalent {
	shownProfiles: SocialProfileProjectionValue[];
}

/**
 * The step of a running Social Profile Rotation: the synchronized server instant,
 * re-read exactly at each step boundary rather than polled (ADR-0009). Undefined
 * while not rotating or while server time is unknown, which shows the first profile.
 */
function useRotationInstant(rotating: () => boolean, dwellMs: () => number) {
	return useClockProjection<number | undefined>(serverTime => rotating()
		? {
				value: serverTime,
				nextChangeInMs: msUntilNextTalentScreenProfile({
					dwellMs: dwellMs(),
					now: serverTime,
				}),
			}
		: { value: undefined, nextChangeInMs: null }, {
		whileServerTimeUnknown: {
			show: () => undefined,
		},
	});
}

/**
 * A Talent Screen's Talents, kept current on a Screen Output (#782): one Talent
 * or a lineup, each with its role, photo and the Social Profiles it shows.
 */
export function useTalentModeData(context: ScreenContext) {
	const config = useScreenModeConfig(context, 'talent');
	const outputReads = useScreenOutputReads(context);
	const shownIds = computed(() => talentScreenTalentIds(config.value));

	const freshness = useScreenModeFreshness<ScreenOutputTalentResponse>({
		hearing: useScreenModeHearing(context, 'talent', () => config.value),
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

	const headerText = computed(() => config.value.headerText || TALENT_SCREEN_AUTO_HEADER_TEXT);
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
