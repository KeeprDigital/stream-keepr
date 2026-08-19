import type { BroadcastGraphicsLiveState, SocialProfileProjectionLiveState } from '~~/shared/modules/broadcast-graphics-live-session';
import type { SocialProfileProjectionDeclaration, SocialProfileProjectionValue } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import {
	applyBroadcastGraphicsCommand,
	broadcastGraphicRenderedSocialProfileValues,
	createInitialBroadcastGraphicsLiveState,
	MAX_SOCIAL_PROFILE_PRESENTATION_LAYERS,
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
	it('uses only the graphic update pair when staged Event Data is explicitly accepted', () => {
		const acceptedAt = 1_010_000;
		const live: BroadcastGraphicsLiveState = {
			...createInitialBroadcastGraphicsLiveState(),
			playout: { lower: { onAir: true, effectiveStartedAt: 1_000_000, cut: false } },
			socialProfileProjections: { lower: { profile: state({
				talent: { id: 7, name: 'Ava Reed' },
				acceptedProfiles: [twitch],
			}) } },
		};
		const staged = { ...declaration, updatePolicy: 'staged' as const };
		const updated = applyBroadcastGraphicsCommand(live, {
			type: 'Update Graphic',
			payload: { graphicId: 'lower', basedOnAcceptedRevision: 0 },
		}, {
			inputs: [],
			acceptedAt,
			durations: { enter: 0, exit: 0, update: 400 },
			socialProfileProjections: [staged],
			resolveSocialProfileProjections: () => ({ profile: {
				talent: { id: 7, name: 'Ava Reed' },
				acceptedProfiles: [youtube],
			} }),
		});
		const graphic = {
			id: 'lower',
			socialProfileProjections: [staged],
		};

		expect(updated.socialProfileProjections!.lower!.profile!.transitionAnchor).toBeUndefined();
		expect(broadcastGraphicRenderedSocialProfileValues(updated, graphic, {
			now: acceptedAt + 100,
			durations: { enter: 0, exit: 0, update: 400 },
		})).toEqual({
			current: { profile: youtube },
			outgoing: { profile: twitch },
		});
		expect(broadcastGraphicRenderedSocialProfileValues(updated, graphic, {
			now: acceptedAt + 400,
			durations: { enter: 0, exit: 0, update: 400 },
		})).toEqual({ current: { profile: youtube } });
	});

	it('bounds rapid staged acceptances to the running and latest pending graphic update pairs', () => {
		const staged = { ...declaration, updatePolicy: 'staged' as const };
		const context = (acceptedAt: number, profile: SocialProfileProjectionValue) => ({
			inputs: [],
			acceptedAt,
			durations: { enter: 0, exit: 0, update: 400 },
			socialProfileProjections: [staged],
			resolveSocialProfileProjections: () => ({ profile: {
				talent: { id: 7, name: 'Ava Reed' },
				acceptedProfiles: [profile],
			} }),
		});
		let live: BroadcastGraphicsLiveState = {
			...createInitialBroadcastGraphicsLiveState(),
			playout: { lower: { onAir: true, effectiveStartedAt: 1_000_000, cut: false } },
			socialProfileProjections: { lower: { profile: state({
				talent: { id: 7, name: 'Ava Reed' },
				acceptedProfiles: [twitch],
			}) } },
		};
		live = applyBroadcastGraphicsCommand(live, {
			type: 'Update Graphic',
			payload: { graphicId: 'lower', basedOnAcceptedRevision: 0 },
		}, context(1_010_000, youtube));
		live = applyBroadcastGraphicsCommand(live, {
			type: 'Update Graphic',
			payload: { graphicId: 'lower', basedOnAcceptedRevision: 1 },
		}, context(1_010_100, x));
		const graphic = { id: 'lower', socialProfileProjections: [staged] };

		expect(broadcastGraphicRenderedSocialProfileValues(live, graphic, {
			now: 1_010_200,
			durations: { enter: 0, exit: 0, update: 400 },
		})).toEqual({ current: { profile: youtube }, outgoing: { profile: twitch } });
		expect(broadcastGraphicRenderedSocialProfileValues(live, graphic, {
			now: 1_010_500,
			durations: { enter: 0, exit: 0, update: 400 },
		})).toEqual({ current: { profile: x }, outgoing: { profile: youtube } });
	});

	it('applies a live projection independently when its selected Talent changes', () => {
		const live = applyBroadcastGraphicsCommand({
			...createInitialBroadcastGraphicsLiveState(),
			playout: { lower: { onAir: true, effectiveStartedAt: 1_000_000, cut: false } },
			sources: { lower: { talent: 7 } },
			socialProfileProjections: { lower: { profile: state({
				talent: { id: 7, name: 'Ava Reed' },
				acceptedProfiles: [twitch, x],
				currentNetwork: 'x',
				manualNetwork: 'x',
			}) } },
		}, {
			type: 'Select Source',
			payload: { graphicId: 'lower', sourceKey: 'talent', selectionId: 8 },
		}, {
			inputs: [],
			acceptedAt: 1_010_000,
			sources: [{ key: 'talent', label: 'Talent', kind: 'talent' }],
			socialProfileProjections: [{ ...declaration, updatePolicy: 'live' }],
			resolveSocialProfileProjections: selections => ({ profile: selections.talent === 8
				? {
						talent: { id: 8, name: 'Bo Lin' },
						acceptedProfiles: [youtube],
					}
				: { acceptedProfiles: [] } }),
		});
		const projection = live.socialProfileProjections!.lower!.profile!;

		expect(projection).toMatchObject({
			talent: { id: 8, name: 'Bo Lin' },
			acceptedProfiles: [youtube],
			currentNetwork: 'youtube',
			transitionAnchor: { startedAt: 1_010_000 },
			rotationAnchor: { network: 'youtube', anchoredAt: 1_010_250 },
		});
		expect(projection.manualNetwork).toBeUndefined();
	});

	it('applies live and staged policies independently for projections on the same graphic', () => {
		const stagedDeclaration = { ...declaration, key: 'staged', updatePolicy: 'staged' as const };
		const liveDeclaration = { ...declaration, key: 'live', updatePolicy: 'live' as const };
		const initialProjection = state({
			talent: { id: 7, name: 'Ava Reed' },
			acceptedProfiles: [twitch],
		});
		const changed = applyBroadcastGraphicsCommand({
			...createInitialBroadcastGraphicsLiveState(),
			playout: { lower: { onAir: true, effectiveStartedAt: 1_000_000, cut: false } },
			socialProfileProjections: { lower: {
				live: initialProjection,
				staged: initialProjection,
			} },
		}, {
			type: 'Resolve Bindings',
			payload: { graphicId: 'lower' },
		}, {
			inputs: [],
			acceptedAt: 1_010_000,
			socialProfileProjections: [liveDeclaration, stagedDeclaration],
			resolveSocialProfileProjections: () => ({
				live: { talent: { id: 7, name: 'Ava Reed' }, acceptedProfiles: [youtube] },
				staged: { talent: { id: 7, name: 'Ava Reed' }, acceptedProfiles: [youtube] },
			}),
		});

		expect(changed.socialProfileProjections!.lower!.live!.acceptedProfiles).toEqual([youtube]);
		expect(changed.socialProfileProjections!.lower!.staged!.acceptedProfiles).toEqual([twitch]);
	});

	it('lets an immediate live re-resolution supersede a running graphic update', () => {
		const changed = applyBroadcastGraphicsCommand({
			...createInitialBroadcastGraphicsLiveState(),
			playout: {
				lower: { onAir: true, effectiveStartedAt: 1_000_000, cut: false, updateStartedAt: 1_009_900 },
			},
			inputs: {
				lower: { working: {}, accepted: {}, acceptedRevision: 1, updateFrom: {} },
			},
			socialProfileProjections: { lower: { profile: state({
				talent: { id: 7, name: 'Ava Reed' },
				acceptedProfiles: [twitch],
				updateFrom: twitch,
			}) } },
		}, {
			type: 'Resolve Bindings',
			payload: { graphicId: 'lower' },
		}, {
			inputs: [],
			acceptedAt: 1_010_000,
			durations: { enter: 0, exit: 0, update: 400 },
			socialProfileProjections: [{ ...declaration, updatePolicy: 'live' }],
			resolveSocialProfileProjections: () => ({ profile: {
				talent: { id: 7, name: 'Ava Reed' },
				acceptedProfiles: [{ ...twitch, handle: 'corrected', profileUrl: 'https://www.twitch.tv/corrected' }],
			} }),
		});

		expect(changed.playout.lower!.updateStartedAt).toBeUndefined();
		expect(changed.socialProfileProjections!.lower!.profile!.updateFrom).toBeUndefined();
		expect(changed.socialProfileProjections!.lower!.profile!.transitionAnchor)
			.toMatchObject({ startedAt: 1_010_000 });
	});

	it('moves a removed current network forward in catalog order and transitions through unavailable', () => {
		const liveDeclaration = { ...declaration, updatePolicy: 'live' as const };
		const initial = {
			...createInitialBroadcastGraphicsLiveState(),
			playout: { lower: { onAir: true, effectiveStartedAt: 1_000_000, cut: false } },
			socialProfileProjections: { lower: { profile: state({
				talent: { id: 7, name: 'Ava Reed' },
				acceptedProfiles: [twitch, youtube, x],
				currentNetwork: 'youtube',
				manualNetwork: 'youtube',
				rotationAnchor: { network: 'youtube', anchoredAt: 1_009_000 },
			}) } },
		};
		const resolveAt = (
			live: BroadcastGraphicsLiveState,
			acceptedProfiles: SocialProfileProjectionValue[],
			acceptedAt: number,
		) => applyBroadcastGraphicsCommand(live, {
			type: 'Resolve Bindings',
			payload: { graphicId: 'lower' },
		}, {
			inputs: [],
			acceptedAt,
			socialProfileProjections: [liveDeclaration],
			resolveSocialProfileProjections: () => ({ profile: {
				talent: { id: 7, name: 'Ava Reed' },
				acceptedProfiles,
			} }),
		});

		const removed = resolveAt(initial, [twitch, x], 1_010_000);
		expect(removed.socialProfileProjections!.lower!.profile).toMatchObject({
			currentNetwork: 'x',
			transitionAnchor: { startedAt: 1_010_000 },
			rotationAnchor: { network: 'x', anchoredAt: 1_010_250 },
		});
		expect(removed.socialProfileProjections!.lower!.profile!.manualNetwork).toBeUndefined();

		const unavailable = resolveAt(removed, [], 1_010_500);
		expect(unavailable.socialProfileProjections!.lower!.profile!.currentNetwork).toBeUndefined();
		expect(unavailable.socialProfileProjections!.lower!.profile!.transitionAnchor!.from)
			.toEqual([expect.objectContaining({ values: x })]);

		const available = resolveAt(unavailable, [twitch], 1_011_000);
		expect(available.socialProfileProjections!.lower!.profile).toMatchObject({
			currentNetwork: 'twitch',
			transitionAnchor: { startedAt: 1_011_000, from: [] },
			rotationAnchor: { network: 'twitch', anchoredAt: 1_011_250 },
		});
	});

	it('does not let a restated staged Take accept Event Data, but an off-air Take resolves the latest Talent', () => {
		const initial: BroadcastGraphicsLiveState = {
			...createInitialBroadcastGraphicsLiveState(),
			playout: { lower: { onAir: true, effectiveStartedAt: 1_000_000, cut: false } },
			socialProfileProjections: { lower: { profile: state({
				talent: { id: 7, name: 'Ava Reed' },
				acceptedProfiles: [twitch, x],
				currentNetwork: 'x',
				manualNetwork: 'x',
			}) } },
		};
		const context = {
			inputs: [],
			acceptedAt: 1_010_000,
			socialProfileProjections: [{ ...declaration, updatePolicy: 'staged' as const }],
			resolveSocialProfileProjections: () => ({ profile: {
				talent: { id: 8, name: 'Bo Lin' },
				acceptedProfiles: [youtube],
			} }),
		};
		const restated = applyBroadcastGraphicsCommand(initial, {
			type: 'Take',
			payload: { graphicId: 'lower' },
		}, context);
		expect(restated.socialProfileProjections!.lower!.profile!.talent?.id).toBe(7);

		const off = {
			...initial,
			playout: { lower: { onAir: false, effectiveStartedAt: 1_009_000, cut: false } },
		};
		const retaken = applyBroadcastGraphicsCommand(off, {
			type: 'Take',
			payload: { graphicId: 'lower' },
		}, context);
		expect(retaken.socialProfileProjections!.lower!.profile).toMatchObject({
			talent: { id: 8, name: 'Bo Lin' },
			acceptedProfiles: [youtube],
			currentNetwork: 'youtube',
			rotationAnchor: { network: 'youtube', anchoredAt: 1_010_000 },
		});
		expect(retaken.socialProfileProjections!.lower!.profile!.manualNetwork).toBeUndefined();
	});

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

	it.each([
		['crossfade', [
			{ values: twitch, opacity: 0.5, offsetX: 0, offsetY: 0 },
			{ values: { ...twitch, handle: 'updated', profileUrl: 'https://www.twitch.tv/updated' }, opacity: 0.5, offsetX: 0, offsetY: 0 },
		]],
		['slide-left', [
			{ values: twitch, opacity: 1, offsetX: -50, offsetY: 0 },
			{ values: { ...twitch, handle: 'updated', profileUrl: 'https://www.twitch.tv/updated' }, opacity: 1, offsetX: 50, offsetY: 0 },
		]],
	] as const)('keeps distinct old and new tuples on the same network during %s', (transition, expected) => {
		const updated = { ...twitch, handle: 'updated', profileUrl: 'https://www.twitch.tv/updated' };
		const changing = state({
			acceptedProfiles: [updated],
			currentNetwork: 'twitch',
			rotationAnchor: { network: 'twitch', anchoredAt: 1_000_250 },
			transitionAnchor: {
				startedAt: 1_000_000,
				from: [{ values: twitch, opacity: 1, offsetX: 0, offsetY: 0 }],
			},
		});

		expect(projectSocialProfilePresentation(changing, { ...declaration, transition }, {
			onAir: true,
			now: 1_000_125,
		}).layers).toEqual(expected);
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

	it('bounds a newly interrupted sampled visual at the durable layer maximum', () => {
		const updated = { ...twitch, handle: 'updated', profileUrl: 'https://www.twitch.tv/updated' };
		const crowded = state({
			acceptedProfiles: [updated, youtube],
			currentNetwork: 'twitch',
			transitionAnchor: {
				startedAt: 1_000_000,
				from: Array.from({ length: MAX_SOCIAL_PROFILE_PRESENTATION_LAYERS }, (_, index) => ({
					values: { ...twitch, handle: `old${index}`, profileUrl: `https://www.twitch.tv/old${index}` },
					opacity: 1 / MAX_SOCIAL_PROFILE_PRESENTATION_LAYERS,
					offsetX: 0,
					offsetY: 0,
				})),
			},
		});
		const selected = applyBroadcastGraphicsCommand({
			...createInitialBroadcastGraphicsLiveState(),
			playout: { lower: { onAir: true, effectiveStartedAt: 1_000_000, cut: false } },
			socialProfileProjections: { lower: { profile: crowded } },
		}, {
			type: 'Select Social Profile',
			payload: { graphicId: 'lower', projectionKey: 'profile', network: 'youtube' },
		}, {
			inputs: [],
			acceptedAt: 1_000_125,
			socialProfileProjections: [declaration],
		});

		expect(selected.socialProfileProjections!.lower!.profile!.transitionAnchor!.from)
			.toHaveLength(MAX_SOCIAL_PROFILE_PRESENTATION_LAYERS);
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
