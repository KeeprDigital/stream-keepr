import type { FeatureMatchLayoutConfig } from './screenConfig';

/**
 * The Feature Match Layout Template library artifact.
 *
 * A Feature Match Layout Template is a user-created reusable Feature Match Layout
 * that an author copies into any Screen's Feature Match Overlay configuration. It
 * is never live Screen state: it carries no Feature Match Slot assignment, no
 * session clock, and no Player — a Source Item declares a Source Role and a Graphic
 * Text Template binds a Feature Match token, and both resolve against whatever Slot
 * the receiving Screen happens to hold.
 *
 * It is a sibling of the Broadcast Graphic Template rather than a variant of it.
 * The two share the Template Package envelope and nothing else: different
 * documents, different libraries, different workflows, and packages that are not
 * interchangeable in either direction.
 *
 * `id` is the stable identity and `revision` the automatically managed revision the
 * glossary requires: identity survives every edit, and each accepted edit advances
 * the revision by one. Together they are the provenance a Template Package carries.
 */

export const MAX_FEATURE_MATCH_LAYOUT_TEMPLATE_NAME_LENGTH = 100;
export const MAX_FEATURE_MATCH_LAYOUT_TEMPLATE_DESCRIPTION_LENGTH = 500;

/**
 * Where a Template Package brought a library entry in from: the exporting
 * installation's Template identity and the revision it was exported at, and nothing
 * more. Never an update link, and absent on every entry authored here.
 */
export interface FeatureMatchLayoutTemplateOrigin {
	sourceTemplateIdentity: string;
	sourceTemplateRevision: number | null;
}

/**
 * One library entry as the library browser reads it.
 *
 * Without the layout itself: browsing is choosing between designs, and the counts
 * are what an author chooses on. Placing resolves the document server-side, so no
 * browser needs to hold one.
 */
export interface FeatureMatchLayoutTemplateSummary {
	id: string;
	name: string;
	description: string | null;
	revision: number;
	/** Present only on an entry a Template Package installed. */
	provenance?: FeatureMatchLayoutTemplateOrigin;
	/**
	 * Whether this installation authored the entry, and so may rename, describe,
	 * revise, or delete it. An imported entry is the Graphics Asset Library's own
	 * record: browsed, placed, and exported here, never written.
	 */
	authored: boolean;
	/** Graphic Items in the saved composition, Graphic Group children included. */
	itemCount: number;
	/** Host-owned Source Items the layout frames. */
	sourceCount: number;
	createdAt: Date;
	updatedAt: Date;
}

/** One library entry with the Feature Match Layout it stores. */
export interface FeatureMatchLayoutTemplateResponse extends FeatureMatchLayoutTemplateSummary {
	document: FeatureMatchLayoutConfig;
}

export interface FeatureMatchLayoutTemplateListResponse {
	templates: FeatureMatchLayoutTemplateSummary[];
}
