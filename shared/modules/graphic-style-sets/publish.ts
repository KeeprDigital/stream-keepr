import type { BroadcastGraphicConfig } from '../../types/graphics';
import type {
	GraphicStyleSetEntry,
	GraphicStyleSetPublishIssue,
	GraphicStyleUpdateReview,
} from '../../types/graphicStyleSet';
import type { GraphicStyleSetResolution } from './entries';
import { graphicStyleUpdateChanges } from './apply';
import { resolveGraphicStyleSet } from './entries';

/**
 * What one atomic publish proves, and what a linked template is then offered.
 *
 * Publish is the only moment a Graphic Style Set's entries become something a
 * template can resolve against, so it is where every fault has to be found: a
 * reference to nothing, a reference to the wrong kind of entry, a cycle, an entry in
 * a schema version this build does not read, and a font this installation does not
 * have. Draft edits accumulate freely — an author restructuring a palette passes
 * through every one of those states — and the guarantee is only that a *published*
 * revision is whole.
 *
 * ## Why every issue is reported together
 *
 * A draft is up to two hundred entries and an author fixes them in one sitting.
 * Reporting the first fault would turn one review into a queue of round trips, so
 * resolution collects every issue it finds and publish refuses on all of them at
 * once, each with a stable code and the entry it is about.
 */

/**
 * Whether a Graphic Style Set draft can be published, and everything wrong with it
 * if not.
 *
 * The resolution is returned alongside so a caller that is about to publish does not
 * resolve the same entries twice — the affected-template calculation needs exactly
 * this.
 */
export function validateGraphicStyleSetDraft(entries: readonly GraphicStyleSetEntry[]): {
	resolution: GraphicStyleSetResolution;
	issues: GraphicStyleSetPublishIssue[];
} {
	const resolution = resolveGraphicStyleSet(entries);
	return { resolution, issues: resolution.issues };
}

/**
 * Whether a composition's inherited properties would change under these entries.
 *
 * This is the whole definition of "an update is available": not that the Style Set
 * has a newer revision, but that resolving it produces something different from what
 * the composition already renders. A renamed entry, a newly added entry, and an
 * edited entry this composition never references all resolve to exactly what is
 * already stored, so none of them makes an update available.
 */
export function graphicStyleUpdateAvailable(
	graphic: BroadcastGraphicConfig,
	resolution: GraphicStyleSetResolution,
): boolean {
	return graphicStyleUpdateChanges(graphic, resolution).length > 0;
}

export interface GraphicStyleUpdateReviewSubject {
	id: string;
	name: string;
	/** The Style Set's current published revision. */
	publishedRevision: number;
	published: readonly GraphicStyleSetEntry[] | null;
}

/**
 * What a linked template's author is shown before deciding anything.
 *
 * A template with no link, or linked to a Style Set that has never been published,
 * has nothing to review — reported as an absent Style Set rather than as an empty
 * change list, because the two mean different things to an author looking at the
 * library.
 */
export function graphicStyleUpdateReview(
	graphic: BroadcastGraphicConfig,
	styleSet: GraphicStyleUpdateReviewSubject | null,
): GraphicStyleUpdateReview {
	if (!styleSet || !styleSet.published || !graphic.styleSet)
		return { styleSet: null, available: false, changes: [] };

	const resolution = resolveGraphicStyleSet(styleSet.published);
	const changes = graphicStyleUpdateChanges(graphic, resolution);

	return {
		styleSet: {
			id: styleSet.id,
			name: styleSet.name,
			linkedRevision: graphic.styleSet.revision,
			publishedRevision: styleSet.publishedRevision,
		},
		available: changes.length > 0,
		changes,
	};
}
