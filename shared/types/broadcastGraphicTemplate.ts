import type { BroadcastGraphicConfig } from './graphics';

/**
 * The Broadcast Graphic Template library artifact.
 *
 * A Broadcast Graphic Template is a user-created reusable Broadcast Graphic that
 * an author copies onto any Broadcast Graphics Screen in the installation. It is
 * never live Screen state: nothing in it is a Graphic Playout State, an accepted
 * on-air value, or a selected Event Data entity, and no placed copy points back at
 * it. The library is installation-scoped, which is what makes one template
 * reusable across every Event rather than per-Event property.
 *
 * `id` is the stable identity and `revision` the automatically managed revision
 * the glossary requires: identity survives every edit, and each accepted edit
 * advances the revision by one. Together they are what a Template Package's
 * provenance and a Graphic Style Set update will later name.
 */

export const MAX_BROADCAST_GRAPHIC_TEMPLATE_NAME_LENGTH = 100;
export const MAX_BROADCAST_GRAPHIC_TEMPLATE_DESCRIPTION_LENGTH = 500;

/**
 * One library entry as the library browser reads it.
 *
 * Deliberately without the composition: browsing a library of designs is not
 * downloading them, and the counts are what an author actually chooses between.
 * Placement resolves the document server-side, so no browser ever needs it.
 */
export interface BroadcastGraphicTemplateSummary {
	id: string;
	name: string;
	description: string | null;
	revision: number;
	/** Graphic Items in the saved composition, Graphic Group children included. */
	itemCount: number;
	inputCount: number;
	createdAt: Date;
	updatedAt: Date;
}

/** One library entry with the Broadcast Graphic composition it stores. */
export interface BroadcastGraphicTemplateResponse extends BroadcastGraphicTemplateSummary {
	document: BroadcastGraphicConfig;
}

export interface BroadcastGraphicTemplateListResponse {
	templates: BroadcastGraphicTemplateSummary[];
}
