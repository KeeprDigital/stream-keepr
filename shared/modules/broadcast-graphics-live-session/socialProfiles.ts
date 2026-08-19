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
	/** The bounded sampled visual a latest-wins transition replaces. */
	transitionAnchor?: SocialProfileTransitionAnchor;
	/** The correlated tuple a Graphic Update cross-transition leaves behind. */
	updateFrom?: SocialProfileProjectionValue | null;
	/** The first accepted tuple held behind a running Graphic Update. */
	pendingUpdateFrom?: SocialProfileProjectionValue | null;
}

export interface SocialProfileRotationAnchor {
	network: SupportedSocialNetwork;
	anchoredAt: number;
}

export interface SocialProfileTransitionAnchor {
	startedAt: number;
	from: SocialProfilePresentationLayer[];
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

/** One correlated Presentation Group rendering at a projected visual position. */
export interface SocialProfilePresentationLayer {
	values: SocialProfileProjectionValue;
	opacity: number;
	/** Percentage of the Presentation Group's own width. */
	offsetX: number;
	/** Percentage of the Presentation Group's own height. */
	offsetY: number;
}

/** The complete bounded visual one renderer paints for a Social Profile Projection. */
export interface SocialProfilePresentationProjection {
	phase: SocialProfileRotationPhase;
	layers: SocialProfilePresentationLayer[];
}

/** Hard recovery/render bound: two complete catalog-width sampled visuals. */
export const MAX_SOCIAL_PROFILE_PRESENTATION_LAYERS = SUPPORTED_SOCIAL_NETWORKS.length * 2;

export type BroadcastGraphicSocialProfileProjectionStates
	= Record<string, SocialProfileProjectionLiveState>;

function socialProfileTransitionSlide(
	transition: SocialProfileProjectionDeclaration['transition'],
): { x: number; y: number } | undefined {
	switch (transition) {
		case 'slide-left': return { x: -100, y: 0 };
		case 'slide-right': return { x: 100, y: 0 };
		case 'slide-up': return { x: 0, y: -100 };
		case 'slide-down': return { x: 0, y: 100 };
		default: return undefined;
	}
}

function sameSocialProfileTuple(
	left: SocialProfileProjectionValue,
	right: SocialProfileProjectionValue,
): boolean {
	return left.network === right.network
		&& left.networkLabel === right.networkLabel
		&& left.handle === right.handle
		&& left.profileUrl === right.profileUrl;
}

/** Whether Event Data resolves the same accepted Talent and correlated profile set. */
export function sameSocialProfileProjectionAcceptance(
	left: Pick<SocialProfileProjectionLiveState, 'talent' | 'acceptedProfiles'> | undefined,
	right: Pick<SocialProfileProjectionLiveState, 'talent' | 'acceptedProfiles'> | undefined,
): boolean {
	if (left === undefined || right === undefined)
		return left === right;
	if (left.talent?.id !== right.talent?.id || left.talent?.name !== right.talent?.name)
		return false;
	return left.acceptedProfiles.length === right.acceptedProfiles.length
		&& left.acceptedProfiles.every((profile, index) => {
			const candidate = right.acceptedProfiles[index];
			return candidate !== undefined && sameSocialProfileTuple(profile, candidate);
		});
}

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
	const transitionMs = declaration.transition === 'cut'
		? 0
		: Math.max(0, declaration.transitionDurationMs);
	const interruptedElapsed = state.transitionAnchor && context.now !== undefined
		? context.now - state.transitionAnchor.startedAt
		: Number.POSITIVE_INFINITY;
	if (
		Number.isFinite(context.now)
		&& transitionMs > 0
		&& state.transitionAnchor
		&& interruptedElapsed >= 0
		&& interruptedElapsed < transitionMs
	) {
		return {
			...(fallback ? { current: fallback } : {}),
			phase: { kind: 'transition', elapsedMs: interruptedElapsed, durationMs: transitionMs },
		};
	}
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

/**
 * Project one synchronized Social Profile Presentation Group frame.
 *
 * Values and motion travel together so independently styled ordinary children
 * cannot observe different profiles at one instant. The renderer receives sampled
 * positions rather than a CSS transition, keeping fill, key, preview, and redundant
 * outputs identical at the same synchronized time.
 */
export function projectSocialProfilePresentation(
	state: SocialProfileProjectionLiveState,
	declaration: Pick<SocialProfileProjectionDeclaration, 'dwellMs' | 'transition' | 'transitionDurationMs'>,
	context: { onAir: boolean; now?: number },
): SocialProfilePresentationProjection {
	const rotation = projectSocialProfileRotation(state, declaration, context);
	const transitionAnchor = state.transitionAnchor;
	if (
		rotation.phase.kind === 'transition'
		&& transitionAnchor
		&& rotation.phase.durationMs !== null
	) {
		const durationMs = rotation.phase.durationMs;
		const progress = Math.max(0, Math.min(1, rotation.phase.elapsedMs / durationMs));
		const slide = socialProfileTransitionSlide(declaration.transition);
		const target = rotation.current;
		const hasTarget = target !== undefined
			&& transitionAnchor.from.some(layer => sameSocialProfileTuple(layer.values, target));
		const from = (hasTarget || !rotation.current
			? transitionAnchor.from
			: [
					...transitionAnchor.from,
					{
						values: rotation.current,
						opacity: declaration.transition === 'crossfade' ? 0 : 1,
						offsetX: slide?.x === undefined ? 0 : -slide.x,
						offsetY: slide?.y === undefined ? 0 : -slide.y,
					},
				])
			.slice(-MAX_SOCIAL_PROFILE_PRESENTATION_LAYERS);
		const mix = (start: number, end: number) => start + ((end - start) * progress);

		return {
			phase: rotation.phase,
			layers: from.map((layer) => {
				const isTarget = target !== undefined && sameSocialProfileTuple(layer.values, target);
				if (isTarget) {
					return {
						values: rotation.current!,
						opacity: mix(layer.opacity, 1),
						offsetX: mix(layer.offsetX, 0),
						offsetY: mix(layer.offsetY, 0),
					};
				}
				if (!slide) {
					return {
						...layer,
						opacity: mix(layer.opacity, 0),
					};
				}
				return {
					...layer,
					offsetX: mix(layer.offsetX, slide.x),
					offsetY: mix(layer.offsetY, slide.y),
				};
			}),
		};
	}
	if (!rotation.current)
		return { phase: rotation.phase, layers: [] };
	if (rotation.phase.kind !== 'transition' || !rotation.outgoing || rotation.phase.durationMs === null) {
		return {
			phase: rotation.phase,
			layers: [{ values: rotation.current, opacity: 1, offsetX: 0, offsetY: 0 }],
		};
	}

	const progress = Math.max(0, Math.min(1, rotation.phase.elapsedMs / rotation.phase.durationMs));
	const slide = socialProfileTransitionSlide(declaration.transition);
	if (slide) {
		return {
			phase: rotation.phase,
			layers: [
				{
					values: rotation.outgoing,
					opacity: 1,
					offsetX: slide.x * progress,
					offsetY: slide.y * progress,
				},
				{
					values: rotation.current,
					opacity: 1,
					offsetX: slide.x === 0 ? 0 : -slide.x * (1 - progress),
					offsetY: slide.y === 0 ? 0 : -slide.y * (1 - progress),
				},
			],
		};
	}
	return {
		phase: rotation.phase,
		layers: [
			{ values: rotation.outgoing, opacity: 1 - progress, offsetX: 0, offsetY: 0 },
			{ values: rotation.current, opacity: progress, offsetX: 0, offsetY: 0 },
		],
	};
}

function declaredSocialProfileProjections(
	state: Pick<BroadcastGraphicsLiveState, 'socialProfileProjections'>,
	graphic: Pick<BroadcastGraphicConfig, 'id' | 'socialProfileProjections'>,
): Array<[SocialProfileProjectionDeclaration, SocialProfileProjectionLiveState]> {
	const projections = state.socialProfileProjections?.[graphic.id] ?? {};
	const declarations = new Map(
		(graphic.socialProfileProjections ?? []).map(declaration => [declaration.key, declaration]),
	);
	return Object.entries(projections).flatMap(([projectionKey, projection]) => {
		const declaration = declarations.get(projectionKey);
		return declaration ? [[declaration, projection]] : [];
	});
}

/** Every synchronized Presentation Group frame one live graphic supplies. */
export function socialProfilePresentationProjections(
	state: Pick<BroadcastGraphicsLiveState, 'playout' | 'socialProfileProjections'>,
	graphic: Pick<BroadcastGraphicConfig, 'id' | 'socialProfileProjections'>,
	now?: number,
): Record<string, SocialProfilePresentationProjection> {
	return Object.fromEntries(declaredSocialProfileProjections(state, graphic).map(([declaration, projection]) => [
		declaration.key,
		projectSocialProfilePresentation(projection, declaration, {
			onAir: state.playout[graphic.id]?.onAir === true,
			now,
		}),
	]));
}

/** The current correlated tuples one live Broadcast Graphic supplies to its renderer. */
export function socialProfileProjectionValues(
	state: Pick<BroadcastGraphicsLiveState, 'playout' | 'socialProfileProjections'>,
	graphic: Pick<BroadcastGraphicConfig, 'id' | 'socialProfileProjections'>,
	now?: number,
): SocialProfileProjectionValues {
	return Object.fromEntries(declaredSocialProfileProjections(state, graphic).flatMap(([declaration, projection]) => {
		const current = projectSocialProfileRotation(projection, declaration, {
			onAir: state.playout[graphic.id]?.onAir === true,
			now,
		}).current;
		return current ? [[declaration.key, current]] : [];
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
