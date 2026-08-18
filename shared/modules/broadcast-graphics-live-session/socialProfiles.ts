import type { SupportedSocialNetwork } from '../../socialProfiles';
import type {
	BroadcastGraphicConfig,
	SocialProfileProjectionDeclaration,
	SocialProfileProjectionValue,
	SocialProfileProjectionValues,
} from '../../types/graphics';
import type { GraphicBindingDataSet, GraphicBindingTalent, GraphicSourceSelectionsState } from '../graphics';
import type { BroadcastGraphicsLiveState } from './playout';
import {
	canonicalSocialProfileUrl,
	MAX_SOCIAL_PROFILE_HANDLE_LENGTH,
	SUPPORTED_SOCIAL_NETWORKS,
} from '../../socialProfiles';
import { resolveGraphicSourceSelections } from '../graphics';

/** The accepted Talent identity shown beside one projection in Live Control. */
export interface SocialProfileProjectionTalent {
	id: number;
	name: string;
}

/** Authoritative Social Profile Rotation operator state for one authored projection. */
export interface SocialProfileProjectionLiveState {
	talent?: SocialProfileProjectionTalent;
	/** Populated profiles in Supported Social Network catalog order, never more than six. */
	acceptedProfiles: SocialProfileProjectionValue[];
	/** The immediate command target and the static fallback held without trustworthy time. */
	currentNetwork?: SupportedSocialNetwork;
	/** An operator's retained explicit choice, written only by direct/Previous/Next actions. */
	manualNetwork?: SupportedSocialNetwork;
	/** Absent on pre-rotation state and interpreted as the default, enabled. */
	automatic?: boolean;
	/** The authoritative profile and instant from which automatic progression projects. */
	rotationAnchor?: SocialProfileRotationAnchor;
}

export interface SocialProfileRotationAnchor {
	network: SupportedSocialNetwork;
	anchoredAt: number;
}

export interface SocialProfileRotationPhase {
	kind: 'static' | 'dwell' | 'transition';
	elapsedMs: number;
	durationMs: number | null;
}

/** One renderer's deterministic reading of an authoritative Social Profile Rotation. */
export interface SocialProfileRotationProjection {
	current?: SocialProfileProjectionValue;
	outgoing?: SocialProfileProjectionValue;
	phase: SocialProfileRotationPhase;
}

export type BroadcastGraphicSocialProfileProjectionStates
	= Record<string, SocialProfileProjectionLiveState>;

/**
 * Project the correlated profile and schedule phase at one synchronized instant.
 *
 * The anchor profile receives its complete dwell first. Every later step then
 * reserves the authored transition before the target receives its own complete
 * dwell, so adding visual motion does not shorten readable time or move the
 * authoritative timeline.
 */
export function projectSocialProfileRotation(
	state: SocialProfileProjectionLiveState,
	declaration: Pick<SocialProfileProjectionDeclaration, 'dwellMs' | 'transition' | 'transitionDurationMs'>,
	context: { onAir: boolean; now?: number },
): SocialProfileRotationProjection {
	const fallback = state.acceptedProfiles.find(profile => profile.network === state.currentNetwork)
		?? state.acceptedProfiles[0];
	if (!fallback)
		return { phase: { kind: 'static', elapsedMs: 0, durationMs: null } };

	const anchor = state.rotationAnchor;
	const anchorIndex = anchor
		? state.acceptedProfiles.findIndex(profile => profile.network === anchor.network)
		: -1;
	if (
		state.automatic === false
		|| !context.onAir
		|| context.now === undefined
		|| !Number.isFinite(context.now)
		|| !anchor
		|| !Number.isFinite(anchor.anchoredAt)
		|| anchorIndex < 0
		|| state.acceptedProfiles.length <= 1
	) {
		return {
			current: fallback,
			phase: { kind: 'static', elapsedMs: 0, durationMs: null },
		};
	}

	const dwellMs = Math.max(0, declaration.dwellMs);
	const transitionMs = declaration.transition === 'cut'
		? 0
		: Math.max(0, declaration.transitionDurationMs);
	if (dwellMs === 0) {
		return {
			current: fallback,
			phase: { kind: 'static', elapsedMs: 0, durationMs: null },
		};
	}

	const elapsed = Math.max(0, context.now - anchor.anchoredAt);
	const anchored = state.acceptedProfiles[anchorIndex]!;
	if (elapsed < dwellMs) {
		return {
			current: anchored,
			phase: { kind: 'dwell', elapsedMs: elapsed, durationMs: dwellMs },
		};
	}

	const stepDuration = transitionMs + dwellMs;
	const afterInitialDwell = elapsed - dwellMs;
	const completedSteps = Math.floor(afterInitialDwell / stepDuration);
	const withinStep = afterInitialDwell % stepDuration;
	const outgoing = state.acceptedProfiles[(anchorIndex + completedSteps) % state.acceptedProfiles.length]!;
	const current = state.acceptedProfiles[(anchorIndex + completedSteps + 1) % state.acceptedProfiles.length]!;

	if (transitionMs > 0 && withinStep < transitionMs) {
		return {
			current,
			outgoing,
			phase: { kind: 'transition', elapsedMs: withinStep, durationMs: transitionMs },
		};
	}

	return {
		current,
		phase: {
			kind: 'dwell',
			elapsedMs: withinStep - transitionMs,
			durationMs: dwellMs,
		},
	};
}

/** The current correlated tuples one live Broadcast Graphic supplies to its renderer. */
export function socialProfileProjectionValues(
	state: Pick<BroadcastGraphicsLiveState, 'playout' | 'socialProfileProjections'>,
	graphic: Pick<BroadcastGraphicConfig, 'id' | 'socialProfileProjections'>,
	now?: number,
): SocialProfileProjectionValues {
	const projections = state.socialProfileProjections?.[graphic.id] ?? {};
	const declarations = new Map(
		(graphic.socialProfileProjections ?? []).map(declaration => [declaration.key, declaration]),
	);
	return Object.fromEntries(Object.entries(projections).flatMap(([projectionKey, projection]) => {
		const declaration = declarations.get(projectionKey);
		if (!declaration)
			return [];
		const current = projectSocialProfileRotation(projection, declaration, {
			onAir: state.playout[graphic.id]?.onAir === true,
			now,
		}).current;
		return current ? [[projectionKey, current]] : [];
	}));
}

function talentIdOf(talent: GraphicBindingTalent, data: GraphicBindingDataSet): number | undefined {
	const ownId = (talent as GraphicBindingTalent & { id?: unknown }).id;
	if (typeof ownId === 'number' && Number.isFinite(ownId))
		return ownId;

	const entry = Object.entries(data.talents).find(([, candidate]) => candidate === talent);
	const id = Number(entry?.[0]);
	return Number.isFinite(id) ? id : undefined;
}

/**
 * Resolve every authored projection from one accepted set of Graphic Source Selections.
 *
 * Event Data remains outside live state until Take. This converts its bounded Social
 * Profile map into the correlated tuples program is allowed to show, preserving the
 * application catalog's order rather than JavaScript object-key order.
 */
export function resolveSocialProfileProjectionAcceptances(
	graphic: Pick<BroadcastGraphicConfig, 'sources' | 'socialProfileProjections'>,
	selections: GraphicSourceSelectionsState,
	data: GraphicBindingDataSet,
): BroadcastGraphicSocialProfileProjectionStates {
	const sources = resolveGraphicSourceSelections(graphic.sources, selections, data);
	const accepted: BroadcastGraphicSocialProfileProjectionStates = {};

	for (const projection of graphic.socialProfileProjections ?? []) {
		const source = sources[projection.sourceKey];
		const talent = source?.kind === 'talent' && source.entity !== undefined
			? source.entity as GraphicBindingTalent
			: undefined;
		const talentId = talent ? talentIdOf(talent, data) : undefined;
		const acceptedProfiles = talent && talentId !== undefined
			? SUPPORTED_SOCIAL_NETWORKS.flatMap((network) => {
					const handle = talent.socialProfiles[network.key];
					return handle === undefined || handle.length > MAX_SOCIAL_PROFILE_HANDLE_LENGTH
						? []
						: [{
							network: network.key,
							networkLabel: network.label,
							handle,
							profileUrl: canonicalSocialProfileUrl(network.key, handle),
						} satisfies SocialProfileProjectionValue];
				})
			: [];

		accepted[projection.key] = {
			...(talent && talentId !== undefined
				? { talent: { id: talentId, name: talent.name } }
				: {}),
			acceptedProfiles,
		};
	}

	return accepted;
}
