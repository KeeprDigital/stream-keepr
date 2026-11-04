import type { SocialProfileProjectionValue } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import { msUntilNextTalentScreenProfile, projectTalentScreenSocialProfile } from '~~/shared/modules/talent-screen';

// A Talent Screen's Social Profile Rotation is a clock projection from epoch
// zero: every rendering at one server instant shows the same profile.

function profile(network: SocialProfileProjectionValue['network']): SocialProfileProjectionValue {
	return {
		network,
		networkLabel: network,
		handle: `${network}-handle`,
		profileUrl: `https://example.test/${network}`,
	};
}

const THREE = [
	profile('twitch'),
	profile('x'),
	profile('bluesky'),
];
const DWELL = 8000;

describe('a Talent Screen Social Profile Rotation', () => {
	it.each([
		[
			'the first profile through the first dwell',
			THREE,
			7999,
			'twitch',
		],
		[
			'the next profile once a dwell ends',
			THREE,
			8000,
			'x',
		],
		[
			'the last profile in the third dwell',
			THREE,
			16_000,
			'bluesky',
		],
		[
			'the first again after a full turn',
			THREE,
			24_000,
			'twitch',
		],
		[
			'each lineup Talent\'s own turn of its own profiles at one instant',
			THREE.slice(0, 2),
			24_000,
			'x',
		],
		[
			'one profile always',
			THREE.slice(0, 1),
			16_000,
			'twitch',
		],
		[
			'the first profile while server time is unknown',
			THREE,
			undefined,
			'twitch',
		],
	])('shows %s', (_case, profiles, now, network) => {
		expect(projectTalentScreenSocialProfile(profiles, { dwellMs: DWELL, now })?.network).toBe(network);
	});

	it('shows nothing for a Talent with no profiles', () => {
		expect(projectTalentScreenSocialProfile([], { dwellMs: DWELL, now: 10_000 })).toBeUndefined();
	});

	it.each([
		[0, 8000],
		[7999, 1],
		[8000, 8000],
		[13_000, 3000],
	])('at %i ms, the next profile is %i ms away', (now, ms) => {
		expect(msUntilNextTalentScreenProfile({ dwellMs: DWELL, now })).toBe(ms);
	});
});
