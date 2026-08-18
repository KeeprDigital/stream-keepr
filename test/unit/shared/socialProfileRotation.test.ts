import type { SocialProfileProjectionLiveState } from '~~/shared/modules/broadcast-graphics-live-session';
import type { SocialProfileProjectionDeclaration, SocialProfileProjectionValue } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import {
	applyBroadcastGraphicsCommand,
	createInitialBroadcastGraphicsLiveState,
	projectSocialProfileRotation,
	socialProfileProjectionValues,
} from '~~/shared/modules/broadcast-graphics-live-session';

const profiles: SocialProfileProjectionValue[] = [
	{ network: 'twitch', networkLabel: 'Twitch', handle: 'alpha', profileUrl: 'https://www.twitch.tv/alpha' },
	{ network: 'youtube', networkLabel: 'YouTube', handle: 'bravo', profileUrl: 'https://www.youtube.com/@bravo' },
	{ network: 'x', networkLabel: 'X', handle: 'charlie', profileUrl: 'https://x.com/charlie' },
];

const declaration: SocialProfileProjectionDeclaration = {
	key: 'profile',
	label: 'Talent social profile',
	sourceKey: 'talent',
	presentationGroupId: 'profile-group',
	dwellMs: 8_000,
	transition: 'crossfade',
	transitionDurationMs: 250,
};

function state(overrides: Partial<SocialProfileProjectionLiveState> = {}): SocialProfileProjectionLiveState {
	return {
		acceptedProfiles: profiles,
		currentNetwork: 'youtube',
		automatic: true,
		rotationAnchor: { network: 'youtube', anchoredAt: 1_000_000 },
		...overrides,
	};
}

describe('social profile rotation projection', () => {
	it('reserves a transition before giving every target its complete authored dwell', () => {
		const at = (now: number) => projectSocialProfileRotation(state(), declaration, {
			onAir: true,
			now,
		});

		expect(at(1_000_000)).toMatchObject({
			current: profiles[1],
			phase: { kind: 'dwell', elapsedMs: 0, durationMs: 8_000 },
		});
		expect(at(1_007_999)).toMatchObject({
			current: profiles[1],
			phase: { kind: 'dwell', elapsedMs: 7_999, durationMs: 8_000 },
		});
		expect(at(1_008_000)).toMatchObject({
			outgoing: profiles[1],
			current: profiles[2],
			phase: { kind: 'transition', elapsedMs: 0, durationMs: 250 },
		});
		expect(at(1_008_249)).toMatchObject({
			outgoing: profiles[1],
			current: profiles[2],
			phase: { kind: 'transition', elapsedMs: 249, durationMs: 250 },
		});
		expect(at(1_008_250)).toMatchObject({
			current: profiles[2],
			phase: { kind: 'dwell', elapsedMs: 0, durationMs: 8_000 },
		});
		expect(at(1_016_250)).toMatchObject({
			outgoing: profiles[2],
			current: profiles[0],
			phase: { kind: 'transition', elapsedMs: 0, durationMs: 250 },
		});
	});

	it('starts a full automatic dwell from the retained manual profile on Take', () => {
		const initial = {
			...createInitialBroadcastGraphicsLiveState(),
			socialProfileProjections: {
				lower: {
					profile: state({
						currentNetwork: 'x',
						manualNetwork: 'x',
						automatic: undefined,
						rotationAnchor: undefined,
					}),
				},
			},
		};

		const taken = applyBroadcastGraphicsCommand(initial, {
			type: 'Take',
			payload: { graphicId: 'lower' },
		}, {
			inputs: [],
			acceptedAt: 2_000_000,
			socialProfileProjections: [declaration],
			resolveSocialProfileProjections: () => ({
				profile: { acceptedProfiles: profiles },
			}),
		});

		expect(taken.socialProfileProjections?.lower?.profile).toEqual({
			acceptedProfiles: profiles,
			currentNetwork: 'x',
			manualNetwork: 'x',
			automatic: true,
			rotationAnchor: { network: 'x', anchoredAt: 2_000_000 },
		});
	});

	it('re-anchors a manual selection before automatic advancement resumes', () => {
		const selected = applyBroadcastGraphicsCommand({
			...createInitialBroadcastGraphicsLiveState(),
			socialProfileProjections: { lower: { profile: state() } },
		}, {
			type: 'Select Social Profile',
			payload: { graphicId: 'lower', projectionKey: 'profile', network: 'twitch' },
		}, {
			inputs: [],
			acceptedAt: 3_000_000,
			socialProfileProjections: [declaration],
		});

		expect(selected.socialProfileProjections?.lower?.profile).toMatchObject({
			currentNetwork: 'twitch',
			manualNetwork: 'twitch',
			rotationAnchor: { network: 'twitch', anchoredAt: 3_000_000 },
		});
		expect(projectSocialProfileRotation(
			selected.socialProfileProjections!.lower!.profile!,
			declaration,
			{ onAir: true, now: 3_007_999 },
		).current).toEqual(profiles[0]);
	});

	it.each([
		['Next Social Profile', 'twitch'],
		['Previous Social Profile', 'youtube'],
	] as const)('%s steps from the automatically projected profile', (type, expectedNetwork) => {
		const stepped = applyBroadcastGraphicsCommand({
			...createInitialBroadcastGraphicsLiveState(),
			playout: { lower: { onAir: true, effectiveStartedAt: 999_000, cut: false } },
			socialProfileProjections: { lower: { profile: state() } },
		}, {
			type,
			payload: { graphicId: 'lower', projectionKey: 'profile' },
		}, {
			inputs: [],
			acceptedAt: 1_008_100,
			socialProfileProjections: [declaration],
		});

		expect(stepped.socialProfileProjections?.lower?.profile).toMatchObject({
			currentNetwork: expectedNetwork,
			manualNetwork: expectedNetwork,
			rotationAnchor: { network: expectedNetwork, anchoredAt: 1_008_100 },
		});
	});

	it('freezes the authoritative projected profile when Automatic is disabled and re-anchors it on resume', () => {
		const onAir = {
			...createInitialBroadcastGraphicsLiveState(),
			playout: { lower: { onAir: true, effectiveStartedAt: 999_000, cut: false } },
			socialProfileProjections: { lower: { profile: state() } },
		};
		const paused = applyBroadcastGraphicsCommand(onAir, {
			type: 'Set Social Profile Automatic',
			payload: { graphicId: 'lower', projectionKey: 'profile', automatic: false },
		}, {
			inputs: [],
			acceptedAt: 1_008_100,
			socialProfileProjections: [declaration],
		});

		expect(paused.socialProfileProjections?.lower?.profile).toMatchObject({
			currentNetwork: 'x',
			automatic: false,
			rotationAnchor: { network: 'x', anchoredAt: 1_008_100 },
		});
		expect(paused.socialProfileProjections?.lower?.profile).not.toHaveProperty('manualNetwork');

		const resumed = applyBroadcastGraphicsCommand(paused, {
			type: 'Set Social Profile Automatic',
			payload: { graphicId: 'lower', projectionKey: 'profile', automatic: true },
		}, {
			inputs: [],
			acceptedAt: 1_020_000,
			socialProfileProjections: [declaration],
		});

		expect(resumed.socialProfileProjections?.lower?.profile).toMatchObject({
			currentNetwork: 'x',
			automatic: true,
			rotationAnchor: { network: 'x', anchoredAt: 1_020_000 },
		});
		expect(resumed.socialProfileProjections?.lower?.profile).not.toHaveProperty('manualNetwork');
	});

	it('holds the projected profile when hidden and gives the retained manual profile a fresh dwell on the next Take', () => {
		const onAir = {
			...createInitialBroadcastGraphicsLiveState(),
			playout: { lower: { onAir: true, effectiveStartedAt: 999_000, cut: false } },
			socialProfileProjections: { lower: { profile: state() } },
		};
		const hidden = applyBroadcastGraphicsCommand(onAir, {
			type: 'Out',
			payload: { graphicId: 'lower' },
		}, {
			inputs: [],
			acceptedAt: 1_008_100,
			socialProfileProjections: [declaration],
		});

		expect(projectSocialProfileRotation(
			hidden.socialProfileProjections!.lower!.profile!,
			declaration,
			{ onAir: false, now: 9_000_000 },
		).current).toEqual(profiles[2]);

		const shown = applyBroadcastGraphicsCommand(hidden, {
			type: 'Take',
			payload: { graphicId: 'lower' },
		}, {
			inputs: [],
			acceptedAt: 9_000_000,
			socialProfileProjections: [declaration],
			resolveSocialProfileProjections: () => ({ profile: { acceptedProfiles: profiles } }),
		});
		expect(shown.socialProfileProjections?.lower?.profile).toMatchObject({
			currentNetwork: 'twitch',
			rotationAnchor: { network: 'twitch', anchoredAt: 9_000_000 },
		});
		expect(shown.socialProfileProjections?.lower?.profile).not.toHaveProperty('manualNetwork');
	});

	it('freezes an on-air rotation when a Graphic Channel Take hides its member', () => {
		const onAir = {
			...createInitialBroadcastGraphicsLiveState(),
			playout: { lower: { onAir: true, effectiveStartedAt: 999_000, cut: false } },
			socialProfileProjections: { lower: { profile: state() } },
		};
		const replaced = applyBroadcastGraphicsCommand(onAir, {
			type: 'Take',
			payload: { graphicId: 'replacement' },
		}, {
			inputs: [],
			acceptedAt: 1_008_100,
			channel: {
				handoff: 'overlap',
				members: [
					{ graphicId: 'lower', socialProfileProjections: [declaration] },
					{ graphicId: 'replacement' },
				],
			},
		});

		expect(replaced.playout.lower?.onAir).toBe(false);
		expect(projectSocialProfileRotation(
			replaced.socialProfileProjections!.lower!.profile!,
			declaration,
			{ onAir: false, now: 9_000_000 },
		).current).toEqual(profiles[2]);
	});

	it('starts a queued Graphic Channel member\'s full dwell when it reaches program', () => {
		const queued = applyBroadcastGraphicsCommand({
			...createInitialBroadcastGraphicsLiveState(),
			playout: { outgoing: { onAir: true, effectiveStartedAt: 900_000, cut: false } },
		}, {
			type: 'Take',
			payload: { graphicId: 'lower' },
		}, {
			inputs: [],
			acceptedAt: 1_000_000,
			socialProfileProjections: [declaration],
			resolveSocialProfileProjections: () => ({ profile: { acceptedProfiles: profiles } }),
			channel: {
				handoff: 'out-then-in',
				members: [
					{ graphicId: 'outgoing', durations: { exit: 10_000 } },
					{ graphicId: 'lower' },
				],
			},
		});
		const projection = queued.socialProfileProjections!.lower!.profile!;

		expect(queued.playout.lower?.effectiveStartedAt).toBe(1_010_000);
		expect(projectSocialProfileRotation(projection, declaration, {
			onAir: true,
			now: 1_010_000,
		})).toMatchObject({
			current: profiles[0],
			phase: { kind: 'dwell', elapsedMs: 0, durationMs: 8_000 },
		});
	});

	it('holds a bounded static presentation for zero or one profile and without trustworthy synchronized time', () => {
		expect(projectSocialProfileRotation(state({ acceptedProfiles: [], currentNetwork: undefined }), declaration, {
			onAir: true,
			now: 9_000_000,
		})).toEqual({ phase: { kind: 'static', elapsedMs: 0, durationMs: null } });

		expect(projectSocialProfileRotation(state({
			acceptedProfiles: [profiles[0]!],
			currentNetwork: 'twitch',
			rotationAnchor: { network: 'twitch', anchoredAt: 1_000_000 },
		}), declaration, { onAir: true, now: 9_000_000 })).toEqual({
			current: profiles[0],
			phase: { kind: 'static', elapsedMs: 0, durationMs: null },
		});

		expect(projectSocialProfileRotation(state(), declaration, { onAir: true })).toEqual({
			current: profiles[1],
			phase: { kind: 'static', elapsedMs: 0, durationMs: null },
		});
	});

	it('projects long elapsed intervals in constant bounded state and identically for redundant renderers', () => {
		const now = 1_000_000 + 8_000 + (1_000_000 * 8_250) + 125;
		const first = projectSocialProfileRotation(state(), declaration, { onAir: true, now });
		const redundant = projectSocialProfileRotation(structuredClone(state()), declaration, { onAir: true, now });

		expect(first).toEqual({
			outgoing: profiles[2],
			current: profiles[0],
			phase: { kind: 'transition', elapsedMs: 125, durationMs: 250 },
		});
		expect(redundant).toEqual(first);
	});

	it('treats Cut as an immediate boundary without transition scheduling', () => {
		const cut = { ...declaration, transition: 'cut' as const };

		expect(projectSocialProfileRotation(state(), cut, { onAir: true, now: 1_008_000 })).toEqual({
			current: profiles[2],
			phase: { kind: 'dwell', elapsedMs: 0, durationMs: 8_000 },
		});
	});

	it.each([
		'crossfade',
		'slide-left',
		'slide-right',
		'slide-up',
		'slide-down',
	] as const)('uses the same reserved authoritative schedule for %s', (transition) => {
		const transitioned = { ...declaration, transition };

		expect(projectSocialProfileRotation(state(), transitioned, {
			onAir: true,
			now: 1_008_125,
		})).toEqual({
			outgoing: profiles[1],
			current: profiles[2],
			phase: { kind: 'transition', elapsedMs: 125, durationMs: 250 },
		});
	});

	it('treats an absent Automatic field as enabled and rejoins the projected phase after clock recovery', () => {
		const legacy = state({ automatic: undefined });

		expect(projectSocialProfileRotation(legacy, declaration, { onAir: true })).toEqual({
			current: profiles[1],
			phase: { kind: 'static', elapsedMs: 0, durationMs: null },
		});
		expect(projectSocialProfileRotation(legacy, declaration, {
			onAir: true,
			now: 1_008_125,
		})).toEqual({
			outgoing: profiles[1],
			current: profiles[2],
			phase: { kind: 'transition', elapsedMs: 125, durationMs: 250 },
		});
	});

	it('supplies the same clock-projected correlated values through the renderer seam', () => {
		const liveState = {
			...createInitialBroadcastGraphicsLiveState(),
			playout: { lower: { onAir: true, effectiveStartedAt: 999_000, cut: false } },
			socialProfileProjections: { lower: { profile: state() } },
		};
		const graphic = {
			id: 'lower',
			socialProfileProjections: [declaration],
		};

		expect(socialProfileProjectionValues(liveState, graphic, 1_008_100)).toEqual({
			profile: profiles[2],
		});
		expect(socialProfileProjectionValues(liveState, graphic)).toEqual({
			profile: profiles[1],
		});
	});
});
