import { FEATURE_MATCH_TOKEN_KEYS } from './featureMatchTokenCatalogue';
import {
	FEATURE_MATCH_OVERLAY_FRAME_ANIMATION_EFFECT_VALUES,
	FEATURE_MATCH_SOURCE_ROLE_VALUES,
} from './types/screenConfig';

/**
 * The host-owned vocabularies a Feature Match Layout speaks, and the format
 * version they are pinned at.
 *
 * A Feature Match Layout Template carries no Event identity and no operator
 * shorthand. What it carries instead are terms from three vocabularies this
 * application owns, and the receiving installation supplies the meaning of each:
 *
 * - a **Source Role**, which says what a Source Item frames rather than which
 *   camera fills it;
 * - a **Frame animation effect**, which names a renderer that ships with Stream
 *   Keepr rather than describing one;
 * - a **Feature Match token**, which names an entry of the Feature Match token
 *   binding catalogue that a Graphic Text Template's `{placeholder}` binds to.
 *
 * None of the three is data the package can carry, which is exactly what makes
 * them capabilities: an installation either implements a term or it does not, and
 * one that does not must refuse the package rather than render a layout whose
 * source frames nothing, whose Frame is still, or whose text is permanently blank.
 *
 * ## Why one format version rather than three
 *
 * The three vocabularies change together, because they are one answer to one
 * question — what may a Feature Match Layout say about the show it is drawn for.
 * A term added to any of them is a term older installations must refuse, and the
 * version is what lets them. Adding a term does not require a bump: an identity a
 * receiver does not know is refused on the identity alone. The version is for the
 * harder case — a term whose *meaning* changes, where the identity still resolves
 * and only the version can say the sender meant something else by it.
 *
 * ## Why the Animation Effect rebuild did not bump it
 *
 * ADR-0014 asked whether per-effect animation params — which reshaped what a
 * `frame.animation` payload carries — need a version bump. They do not: the
 * effect terms still mean the same renderers, and the payload shape is guarded
 * by the strict layout document schema, not by this version. A pre-rebuild
 * document always carries the retired `mouseDrift*` fields, so it fails the new
 * schema in both directions rather than half-parsing; a bump would additionally
 * refuse older packages that carry no animation at all, which install fine.
 */

export const FEATURE_MATCH_LAYOUT_FORMAT_VERSION = 1;

export const FEATURE_MATCH_LAYOUT_VOCABULARIES = [
	'source-role',
	'frame-animation-effect',
	'token',
] as const;

export type FeatureMatchLayoutVocabulary = typeof FEATURE_MATCH_LAYOUT_VOCABULARIES[number];

/**
 * One vocabulary term as a Template Package capability identity.
 *
 * Namespaced by host and by vocabulary so an identity says which of the three it
 * came from without a second field to carry it, and so no term can ever collide
 * with a Graphic Item Definition's kind or an application font's id.
 */
export function featureMatchLayoutVocabularyIdentity(
	vocabulary: FeatureMatchLayoutVocabulary,
	term: string,
): string {
	return `feature-match/${vocabulary}/${term}`;
}

const TERMS: Record<FeatureMatchLayoutVocabulary, readonly string[]> = {
	'source-role': FEATURE_MATCH_SOURCE_ROLE_VALUES,
	'frame-animation-effect': FEATURE_MATCH_OVERLAY_FRAME_ANIMATION_EFFECT_VALUES,
	'token': FEATURE_MATCH_TOKEN_KEYS,
};

const SUPPORTED_IDENTITIES = new Set(
	FEATURE_MATCH_LAYOUT_VOCABULARIES.flatMap(vocabulary =>
		TERMS[vocabulary].map(term => featureMatchLayoutVocabularyIdentity(vocabulary, term)),
	),
);

/**
 * The format version this installation implements one identity at, or `undefined`
 * for a term it has never heard of.
 *
 * Derived from the vocabularies themselves rather than from a second list, so a
 * role, effect, or token added to one of them is supported by this check the
 * moment it exists — and a package naming one that does not exist here is refused
 * whether it came from a newer installation or from a hand-edited archive.
 */
export function supportedFeatureMatchLayoutVocabularyVersion(
	identity: string,
): number | undefined {
	return SUPPORTED_IDENTITIES.has(identity) ? FEATURE_MATCH_LAYOUT_FORMAT_VERSION : undefined;
}
