import type { SocialProfileProjectionValue } from '../../types/graphics';
import { projectSocialProfileRotation } from '../broadcast-graphics-live-session/socialProfiles';
import { msUntilNextRotationFlip } from '../page-rotation';

/**
 * A Talent Screen's Social Profile Rotation (#782): one Talent's Social Profiles
 * shown one at a time, each for one dwell, cut from one to the next.
 *
 * Unlike a Social Profile Projection's, it has no Live Session to anchor it, so it
 * projects from epoch zero as a Page Rotation with no anchor does (ADR-0009): every
 * rendering at one server instant shows the same profile, and every Talent in a
 * lineup steps at the same instant, each through its own profiles. Nothing writes
 * as it runs. While server time is unknown it shows the first profile.
 */
export function projectTalentScreenSocialProfile(
	profiles: readonly SocialProfileProjectionValue[],
	rotation: { dwellMs: number; now?: number },
): SocialProfileProjectionValue | undefined {
	const [first] = profiles;
	if (!first)
		return undefined;
	return projectSocialProfileRotation(
		{
			acceptedProfiles: [...profiles],
			automatic: true,
			rotationAnchor: { network: first.network, anchoredAt: 0 },
		},
		{ dwellMs: rotation.dwellMs, transition: 'cut', transitionDurationMs: 0 },
		{ onAir: true, now: rotation.now },
	).current;
}

/**
 * Milliseconds until the rotation next steps: every Talent steps at once, so a
 * rendering schedules one re-evaluation for its whole lineup.
 */
export function msUntilNextTalentScreenProfile(rotation: { dwellMs: number; now: number }): number {
	// Any page count above one steps at every dwell boundary.
	return msUntilNextRotationFlip({ pageDurationMs: rotation.dwellMs, totalPages: 2, now: rotation.now }) ?? rotation.dwellMs;
}
