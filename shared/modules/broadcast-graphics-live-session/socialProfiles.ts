import type { SupportedSocialNetwork } from '../../socialProfiles';
import type {
	BroadcastGraphicConfig,
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

/** Manual authoritative state for one authored Social Profile Projection. */
export interface SocialProfileProjectionLiveState {
	talent?: SocialProfileProjectionTalent;
	/** Populated profiles in Supported Social Network catalog order, never more than six. */
	acceptedProfiles: SocialProfileProjectionValue[];
	/** What every rendering currently projects. Absent means the Presentation Group is hidden. */
	currentNetwork?: SupportedSocialNetwork;
	/** An operator's retained explicit choice. Automatic rotation state belongs to #423. */
	manualNetwork?: SupportedSocialNetwork;
}

export type BroadcastGraphicSocialProfileProjectionStates
	= Record<string, SocialProfileProjectionLiveState>;

/** The current correlated tuples one live Broadcast Graphic supplies to its renderer. */
export function socialProfileProjectionValues(
	state: Pick<BroadcastGraphicsLiveState, 'socialProfileProjections'>,
	graphicId: string,
): SocialProfileProjectionValues {
	const projections = state.socialProfileProjections?.[graphicId] ?? {};
	return Object.fromEntries(Object.entries(projections).flatMap(([projectionKey, projection]) => {
		const current = projection.acceptedProfiles.find(profile => profile.network === projection.currentNetwork);
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
