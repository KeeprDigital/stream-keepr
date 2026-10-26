import type {
	BroadcastGraphicsCommandInput,
	BroadcastGraphicsLiveState,
	BroadcastGraphicsReductionContext,
	SocialProfileProjectionLiveState,
} from '~~/shared/modules/broadcast-graphics-live-session';
import type { SocialProfileProjectionDeclaration, SocialProfileProjectionValue } from '~~/shared/types/graphics';
import {
	applyBroadcastGraphicsCommand,
	createInitialBroadcastGraphicsLiveState,
} from '~~/shared/modules/broadcast-graphics-live-session';

type Playout = BroadcastGraphicsLiveState['playout'][string];
type Context = Partial<BroadcastGraphicsReductionContext> & Pick<BroadcastGraphicsReductionContext, 'acceptedAt'>;

export const twitch: SocialProfileProjectionValue = {
	network: 'twitch',
	networkLabel: 'Twitch',
	handle: 'alpha',
	profileUrl: 'https://www.twitch.tv/alpha',
};

export const youtube: SocialProfileProjectionValue = {
	network: 'youtube',
	networkLabel: 'YouTube',
	handle: 'bravo',
	profileUrl: 'https://www.youtube.com/@bravo',
};

export const x: SocialProfileProjectionValue = {
	network: 'x',
	networkLabel: 'X',
	handle: 'charlie',
	profileUrl: 'https://x.com/charlie',
};

export const ava = { id: 7, name: 'Ava Reed' };

/** A crossfading Social Profile Projection keyed `profile`, 8s dwell, 250ms transition. */
export const profileDeclaration: SocialProfileProjectionDeclaration = {
	key: 'profile',
	label: 'Talent social profile',
	sourceKey: 'talent',
	presentationGroupId: 'profile-group',
	dwellMs: 8_000,
	transition: 'crossfade',
	transitionDurationMs: 250,
};

/** A projection rotating automatically through Twitch and YouTube, on Twitch since 1,000,000. */
export function profileState(overrides: Partial<SocialProfileProjectionLiveState> = {}): SocialProfileProjectionLiveState {
	return {
		acceptedProfiles: [twitch, youtube],
		currentNetwork: 'twitch',
		automatic: true,
		rotationAnchor: { network: 'twitch', anchoredAt: 1_000_000 },
		...overrides,
	};
}

/**
 * Live state with `graphicId` on air since `startedAt`, holding `projections`
 * (keyed by projection key) for that graphic.
 */
export function onAirWith(
	projections: Record<string, SocialProfileProjectionLiveState> = {},
	{ graphicId = 'lower', startedAt = 0, playout = {}, ...rest }: { graphicId?: string; startedAt?: number; playout?: Partial<Playout> } & Partial<BroadcastGraphicsLiveState> = {},
): BroadcastGraphicsLiveState {
	return {
		...createInitialBroadcastGraphicsLiveState(),
		...rest,
		playout: {
			[graphicId]: {
				onAir: true,
				effectiveStartedAt: startedAt,
				cut: false,
				...playout,
			},
		},
		socialProfileProjections: { [graphicId]: projections },
	};
}

/** Resolves the `profile` projection to Ava with `profiles`. */
export function resolvingProfile(profiles: SocialProfileProjectionValue[], talent = ava) {
	return () => ({
		profile: { talent, acceptedProfiles: profiles },
	});
}

export function command(live: BroadcastGraphicsLiveState, input: BroadcastGraphicsCommandInput, context: Context): BroadcastGraphicsLiveState {
	return applyBroadcastGraphicsCommand(live, input, { inputs: [], ...context });
}

export function updateGraphic(
	live: BroadcastGraphicsLiveState,
	context: Context & { basedOnAcceptedRevision?: number; graphicId?: string },
): BroadcastGraphicsLiveState {
	const { basedOnAcceptedRevision = 0, graphicId = 'lower', ...rest } = context;
	return command(live, {
		type: 'Update Graphic',
		payload: { graphicId, basedOnAcceptedRevision },
	}, rest);
}
