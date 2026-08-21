import { describe, expect, it } from 'vitest';
import {
	broadcastGraphicsRecoveryFault,
	resolveSocialProfileProjectionAcceptances,
} from '~~/shared/modules/broadcast-graphics-live-session';
import {
	canonicalSocialProfileUrl,
	MAX_SOCIAL_PROFILE_HANDLE_LENGTH,
	normalizeSocialProfileInput,
	SUPPORTED_SOCIAL_NETWORKS,
} from '~~/shared/socialProfiles';

describe('supported Social Network catalog', () => {
	it('owns the stable ordered catalog, labels, icons and canonical URL rules', () => {
		expect(SUPPORTED_SOCIAL_NETWORKS.map(({ key, label, icon }) => ({ key, label, icon }))).toEqual([
			{ key: 'twitch', label: 'Twitch', icon: 'i-simple-icons-twitch' },
			{ key: 'youtube', label: 'YouTube', icon: 'i-simple-icons-youtube' },
			{ key: 'x', label: 'X', icon: 'i-simple-icons-x' },
			{ key: 'instagram', label: 'Instagram', icon: 'i-simple-icons-instagram' },
			{ key: 'tiktok', label: 'TikTok', icon: 'i-simple-icons-tiktok' },
			{ key: 'bluesky', label: 'Bluesky', icon: 'i-simple-icons-bluesky' },
		]);

		expect(canonicalSocialProfileUrl('twitch', 'Caster')).toBe('https://www.twitch.tv/Caster');
		expect(canonicalSocialProfileUrl('youtube', 'Caster')).toBe('https://www.youtube.com/@Caster');
		expect(canonicalSocialProfileUrl('x', 'Caster')).toBe('https://x.com/Caster');
		expect(canonicalSocialProfileUrl('instagram', 'Caster')).toBe('https://www.instagram.com/Caster');
		expect(canonicalSocialProfileUrl('tiktok', 'Caster')).toBe('https://www.tiktok.com/@Caster');
		expect(canonicalSocialProfileUrl('bluesky', 'caster.bsky.social')).toBe('https://bsky.app/profile/caster.bsky.social');
	});
});

describe('normalizeSocialProfileInput', () => {
	it.each([
		['twitch', '  @Caster  ', 'Caster'],
		['youtube', '@@Caster', '@Caster'],
		['x', 'MixedCase', 'MixedCase'],
		['instagram', '   ', undefined],
	] as const)('normalizes the plain %s input %j', (network, input, expected) => {
		expect(normalizeSocialProfileInput(network, input)).toBe(expected);
	});

	it.each([
		['twitch', 'https://www.twitch.tv/Caster', 'Caster'],
		['twitch', 'https://www.twitch.tv/@Caster', 'Caster'],
		['twitch', 'twitch.tv/Caster/', 'Caster'],
		['youtube', 'https://youtube.com/@Caster', 'Caster'],
		['x', 'https://twitter.com/Caster', 'Caster'],
		['x', 'https://x.com/@Caster', 'Caster'],
		['x', 'x.com/Caster', 'Caster'],
		['instagram', 'https://instagram.com/Caster/', 'Caster'],
		['instagram', 'https://instagram.com/@Caster/', 'Caster'],
		['tiktok', 'https://www.tiktok.com/@Caster', 'Caster'],
		['bluesky', 'https://bsky.app/profile/Caster.bsky.social', 'Caster.bsky.social'],
		['bluesky', 'https://bsky.app/profile/@Caster.bsky.social', 'Caster.bsky.social'],
	] as const)('extracts a %s handle from %s', (network, input, expected) => {
		expect(normalizeSocialProfileInput(network, input)).toBe(expected);
	});

	it.each([
		['twitch', 'two words'],
		['twitch', 'https://twitch.tv/'],
		['twitch', 'https://twitch.tv/one/two'],
		['youtube', 'https://youtube.com/Caster'],
		['tiktok', 'https://tiktok.com/@Caster?lang=en'],
		['bluesky', 'https://bsky.app/Caster'],
		['instagram', 'https://x.com/Caster'],
		['x', 'https://example.com/Caster'],
	] as const)('rejects malformed or wrong-network %s input %s', (network, input) => {
		expect(() => normalizeSocialProfileInput(network, input)).toThrow(`valid`);
	});

	it('bounds a handle without encoding any remote network username limit', () => {
		expect(normalizeSocialProfileInput('twitch', 'a'.repeat(MAX_SOCIAL_PROFILE_HANDLE_LENGTH)))
			.toHaveLength(MAX_SOCIAL_PROFILE_HANDLE_LENGTH);
		expect(() => normalizeSocialProfileInput('twitch', 'a'.repeat(MAX_SOCIAL_PROFILE_HANDLE_LENGTH + 1)))
			.toThrow('valid');
	});
});

describe('social Profile Projection acceptance', () => {
	function acceptance(handle: string) {
		return resolveSocialProfileProjectionAcceptances({
			sources: [{ key: 'talent', label: 'Talent', kind: 'talent' }],
			socialProfileProjections: [{
				key: 'profile',
				label: 'Social Profile',
				sourceKey: 'talent',
				presentationGroupId: 'group',
				dwellMs: 8_000,
				transition: 'crossfade',
				transitionDurationMs: 250,
			}],
		}, { talent: 7 }, {
			event: null,
			players: {},
			talents: { 7: { name: 'Legacy Talent', socialProfiles: { twitch: handle } } },
			phases: {},
			rounds: {},
			matches: {},
			featureMatchSlots: {},
			archetypes: {},
		});
	}

	it('accepts the document ceiling and preserves its Talent identity', () => {
		const resolved = acceptance('a'.repeat(MAX_SOCIAL_PROFILE_HANDLE_LENGTH));

		expect(resolved.profile?.talent).toEqual({ id: 7, name: 'Legacy Talent' });
		expect(resolved.profile?.acceptedProfiles[0]?.handle).toHaveLength(MAX_SOCIAL_PROFILE_HANDLE_LENGTH);
	});

	it('omits a legacy over-bound profile instead of persisting state recovery would reject', () => {
		const resolved = acceptance('a'.repeat(MAX_SOCIAL_PROFILE_HANDLE_LENGTH + 1));

		expect(resolved.profile).toEqual({
			talent: { id: 7, name: 'Legacy Talent' },
			acceptedProfiles: [],
		});
	});

	it('omits a zero-length legacy handle instead of persisting state recovery would reject', () => {
		const resolved = acceptance('');

		expect(resolved.profile).toEqual({
			talent: { id: 7, name: 'Legacy Talent' },
			acceptedProfiles: [],
		});
	});

	it('never accepts a profile set recovery refuses, whatever handle Event Data holds', () => {
		const handles = ['', 'a', 'Caster', 'a'.repeat(MAX_SOCIAL_PROFILE_HANDLE_LENGTH), 'a'.repeat(MAX_SOCIAL_PROFILE_HANDLE_LENGTH + 1)];

		for (const handle of handles) {
			const stored = {
				playout: {},
				inputs: {},
				sources: {},
				socialProfileProjections: { lower: acceptance(handle) },
			};

			expect(broadcastGraphicsRecoveryFault(JSON.parse(JSON.stringify(stored)))).toBeNull();
		}
	});
});
