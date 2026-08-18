import type { BroadcastGraphicsLiveState, SocialProfileProjectionLiveState } from '~~/shared/modules/broadcast-graphics-live-session';
import type { SocialProfileProjectionDeclaration, SocialProfileProjectionValue } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import {
	applyBroadcastGraphicsCommand,
	createInitialBroadcastGraphicsLiveState,
	projectSocialProfilePresentation,
} from '~~/shared/modules/broadcast-graphics-live-session';

const twitch: SocialProfileProjectionValue = {
	network: 'twitch',
	networkLabel: 'Twitch',
	handle: 'alpha',
	profileUrl: 'https://www.twitch.tv/alpha',
};

const youtube: SocialProfileProjectionValue = {
	network: 'youtube',
	networkLabel: 'YouTube',
	handle: 'bravo',
	profileUrl: 'https://www.youtube.com/@bravo',
};

const x: SocialProfileProjectionValue = {
	network: 'x',
	networkLabel: 'X',
	handle: 'charlie',
	profileUrl: 'https://x.com/charlie',
};

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
		acceptedProfiles: [twitch, youtube],
		currentNetwork: 'twitch',
		automatic: true,
		rotationAnchor: { network: 'twitch', anchoredAt: 1_000_000 },
		...overrides,
	};
}

describe('social profile transition projection', () => {
	it('crossfades the correlated outgoing and incoming presentations at one synchronized midpoint', () => {
		expect(projectSocialProfilePresentation(state(), declaration, {
			onAir: true,
			now: 1_008_125,
		})).toEqual({
			phase: { kind: 'transition', elapsedMs: 125, durationMs: 250 },
			layers: [
				{ values: twitch, opacity: 0.5, offsetX: 0, offsetY: 0 },
				{ values: youtube, opacity: 0.5, offsetX: 0, offsetY: 0 },
			],
		});
	});

	it('slides left without either presentation escaping the Presentation Group coordinate space', () => {
		expect(projectSocialProfilePresentation(state(), { ...declaration, transition: 'slide-left' }, {
			onAir: true,
			now: 1_008_125,
		}).layers).toEqual([
			{ values: twitch, opacity: 1, offsetX: -50, offsetY: 0 },
			{ values: youtube, opacity: 1, offsetX: 50, offsetY: 0 },
		]);
	});

	it.each([
		['slide-right', 50, 0, -50, 0],
		['slide-up', 0, -50, 0, 50],
		['slide-down', 0, 50, 0, -50],
	] as const)('projects %s in its authored direction', (transition, outgoingX, outgoingY, incomingX, incomingY) => {
		expect(projectSocialProfilePresentation(state(), { ...declaration, transition }, {
			onAir: true,
			now: 1_008_125,
		}).layers).toEqual([
			{ values: twitch, opacity: 1, offsetX: outgoingX, offsetY: outgoingY },
			{ values: youtube, opacity: 1, offsetX: incomingX, offsetY: incomingY },
		]);
	});

	it('replaces an in-progress transition from the exact currently rendered visual state', () => {
		const initial = state({ acceptedProfiles: [twitch, youtube, x] });
		const before = projectSocialProfilePresentation(initial, declaration, {
			onAir: true,
			now: 1_008_125,
		});
		const selected = applyBroadcastGraphicsCommand({
			...createInitialBroadcastGraphicsLiveState(),
			playout: { lower: { onAir: true, effectiveStartedAt: 1_000_000, cut: false } },
			socialProfileProjections: { lower: { profile: initial } },
		}, {
			type: 'Select Social Profile',
			payload: { graphicId: 'lower', projectionKey: 'profile', network: 'x' },
		}, {
			inputs: [],
			acceptedAt: 1_008_125,
			socialProfileProjections: [declaration],
		});
		const next = selected.socialProfileProjections!.lower!.profile!;

		expect(projectSocialProfilePresentation(next, declaration, {
			onAir: true,
			now: 1_008_125,
		}).layers).toEqual([
			...before.layers,
			{ values: x, opacity: 0, offsetX: 0, offsetY: 0 },
		]);
		expect(projectSocialProfilePresentation(next, declaration, {
			onAir: true,
			now: 1_008_250,
		}).layers).toEqual([
			{ values: twitch, opacity: 0.25, offsetX: 0, offsetY: 0 },
			{ values: youtube, opacity: 0.25, offsetX: 0, offsetY: 0 },
			{ values: x, opacity: 0.5, offsetX: 0, offsetY: 0 },
		]);
		expect(projectSocialProfilePresentation(next, declaration, {
			onAir: true,
			now: 1_008_375,
		})).toEqual({
			phase: { kind: 'dwell', elapsedMs: 0, durationMs: 8_000 },
			layers: [{ values: x, opacity: 1, offsetX: 0, offsetY: 0 }],
		});
	});

	it('restarts an interrupted slide from the sampled positions already on program', () => {
		const sliding = { ...declaration, transition: 'slide-left' as const };
		const initial = state({ acceptedProfiles: [twitch, youtube, x] });
		const selected = applyBroadcastGraphicsCommand({
			...createInitialBroadcastGraphicsLiveState(),
			playout: { lower: { onAir: true, effectiveStartedAt: 1_000_000, cut: false } },
			socialProfileProjections: { lower: { profile: initial } },
		}, {
			type: 'Select Social Profile',
			payload: { graphicId: 'lower', projectionKey: 'profile', network: 'x' },
		}, {
			inputs: [],
			acceptedAt: 1_008_125,
			socialProfileProjections: [sliding],
		});
		const next = selected.socialProfileProjections!.lower!.profile!;

		expect(projectSocialProfilePresentation(next, sliding, {
			onAir: true,
			now: 1_008_125,
		}).layers).toEqual([
			{ values: twitch, opacity: 1, offsetX: -50, offsetY: 0 },
			{ values: youtube, opacity: 1, offsetX: 50, offsetY: 0 },
			{ values: x, opacity: 1, offsetX: 100, offsetY: 0 },
		]);
		expect(projectSocialProfilePresentation(next, sliding, {
			onAir: true,
			now: 1_008_250,
		}).layers).toEqual([
			{ values: twitch, opacity: 1, offsetX: -75, offsetY: 0 },
			{ values: youtube, opacity: 1, offsetX: -25, offsetY: 0 },
			{ values: x, opacity: 1, offsetX: 50, offsetY: 0 },
		]);
	});

	it('keeps rapid select and step actions latest-wins without building a transition backlog', () => {
		let live: BroadcastGraphicsLiveState = {
			...createInitialBroadcastGraphicsLiveState(),
			playout: { lower: { onAir: true, effectiveStartedAt: 1_000_000, cut: false } },
			socialProfileProjections: {
				lower: { profile: state({ acceptedProfiles: [twitch, youtube, x] }) },
			},
		};
		live = applyBroadcastGraphicsCommand(live, {
			type: 'Select Social Profile',
			payload: { graphicId: 'lower', projectionKey: 'profile', network: 'x' },
		}, { inputs: [], acceptedAt: 1_008_125, socialProfileProjections: [declaration] });
		live = applyBroadcastGraphicsCommand(live, {
			type: 'Next Social Profile',
			payload: { graphicId: 'lower', projectionKey: 'profile' },
		}, { inputs: [], acceptedAt: 1_008_175, socialProfileProjections: [declaration] });
		live = applyBroadcastGraphicsCommand(live, {
			type: 'Previous Social Profile',
			payload: { graphicId: 'lower', projectionKey: 'profile' },
		}, { inputs: [], acceptedAt: 1_008_225, socialProfileProjections: [declaration] });
		const final = live.socialProfileProjections!.lower!.profile!;

		expect(final.currentNetwork).toBe('x');
		expect(final.transitionAnchor?.from.length).toBeLessThanOrEqual(3);
		expect(projectSocialProfilePresentation(final, declaration, {
			onAir: true,
			now: 1_008_475,
		}).layers).toEqual([{ values: x, opacity: 1, offsetX: 0, offsetY: 0 }]);
	});

	it('transitions between transparency and an available Presentation Group without fabricating content', () => {
		const appearing = state({
			acceptedProfiles: [twitch],
			currentNetwork: 'twitch',
			rotationAnchor: { network: 'twitch', anchoredAt: 1_000_250 },
			transitionAnchor: { startedAt: 1_000_000, from: [] },
		});
		const disappearing = state({
			acceptedProfiles: [],
			currentNetwork: undefined,
			rotationAnchor: undefined,
			transitionAnchor: {
				startedAt: 1_000_000,
				from: [{ values: twitch, opacity: 1, offsetX: 0, offsetY: 0 }],
			},
		});

		expect(projectSocialProfilePresentation(appearing, declaration, {
			onAir: true,
			now: 1_000_000,
		}).layers).toEqual([
			{ values: twitch, opacity: 0, offsetX: 0, offsetY: 0 },
		]);
		expect(projectSocialProfilePresentation(appearing, declaration, {
			onAir: true,
			now: 1_000_125,
		}).layers).toEqual([
			{ values: twitch, opacity: 0.5, offsetX: 0, offsetY: 0 },
		]);
		expect(projectSocialProfilePresentation(disappearing, declaration, {
			onAir: true,
			now: 1_000_000,
		}).layers).toEqual([
			{ values: twitch, opacity: 1, offsetX: 0, offsetY: 0 },
		]);
		expect(projectSocialProfilePresentation(disappearing, declaration, {
			onAir: true,
			now: 1_000_125,
		}).layers).toEqual([
			{ values: twitch, opacity: 0.5, offsetX: 0, offsetY: 0 },
		]);
		expect(projectSocialProfilePresentation(appearing, declaration, {
			onAir: true,
			now: 1_000_250,
		}).layers).toEqual([{ values: twitch, opacity: 1, offsetX: 0, offsetY: 0 }]);
		expect(projectSocialProfilePresentation(disappearing, declaration, {
			onAir: true,
			now: 1_000_250,
		}).layers).toEqual([]);
		expect(projectSocialProfilePresentation(state({
			acceptedProfiles: [],
			currentNetwork: undefined,
			rotationAnchor: undefined,
		}), declaration, { onAir: true, now: 1_000_125 }).layers).toEqual([]);
	});

	it('cuts immediately and saturates non-Cut transitions at their authored duration', () => {
		expect(projectSocialProfilePresentation(state(), { ...declaration, transition: 'cut' }, {
			onAir: true,
			now: 1_008_000,
		}).layers).toEqual([{ values: youtube, opacity: 1, offsetX: 0, offsetY: 0 }]);
		expect(projectSocialProfilePresentation(state(), declaration, {
			onAir: true,
			now: 1_008_250,
		})).toEqual({
			phase: { kind: 'dwell', elapsedMs: 0, durationMs: 8_000 },
			layers: [{ values: youtube, opacity: 1, offsetX: 0, offsetY: 0 }],
		});
	});

	it('continues the exact automatic transition frame underneath Out and a Take reversal', () => {
		const onAir = {
			...createInitialBroadcastGraphicsLiveState(),
			playout: { lower: { onAir: true, effectiveStartedAt: 1_000_000, cut: false } },
			socialProfileProjections: { lower: { profile: state() } },
		};
		const beforeOut = projectSocialProfilePresentation(
			onAir.socialProfileProjections.lower.profile,
			declaration,
			{ onAir: true, now: 1_008_125 },
		);
		const exiting = applyBroadcastGraphicsCommand(onAir, {
			type: 'Out',
			payload: { graphicId: 'lower' },
		}, {
			inputs: [],
			acceptedAt: 1_008_125,
			durations: { exit: 1_000 },
			socialProfileProjections: [declaration],
		});
		const frozen = exiting.socialProfileProjections!.lower!.profile!;

		expect(projectSocialProfilePresentation(frozen, declaration, {
			onAir: false,
			now: 1_008_125,
		})).toEqual(beforeOut);
		expect(projectSocialProfilePresentation(frozen, declaration, {
			onAir: false,
			now: 1_008_250,
		}).layers).toEqual([{ values: youtube, opacity: 1, offsetX: 0, offsetY: 0 }]);

		const reversed = applyBroadcastGraphicsCommand(exiting, {
			type: 'Take',
			payload: { graphicId: 'lower' },
		}, {
			inputs: [],
			acceptedAt: 1_008_175,
			durations: { enter: 1_000, exit: 1_000 },
			socialProfileProjections: [declaration],
		});
		expect(projectSocialProfilePresentation(
			reversed.socialProfileProjections!.lower!.profile!,
			declaration,
			{ onAir: true, now: 1_008_175 },
		)).toEqual(projectSocialProfilePresentation(frozen, declaration, {
			onAir: false,
			now: 1_008_175,
		}));
	});
});
