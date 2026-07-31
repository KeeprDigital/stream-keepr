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
 * Where a Template Package brought a library entry in from.
 *
 * The exporting installation's Template identity and the revision it was exported
 * at, and nothing more. It exists so a later package of the same design can be
 * recognised as related; it is never an update link, nothing re-reads it when the
 * entry is revised here, and the entry's own `revision` starts from 1 like any
 * other. Absent on every entry authored here.
 */
export interface BroadcastGraphicTemplateOrigin {
	sourceTemplateIdentity: string;
	sourceTemplateRevision: number | null;
}

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
	/** Present only on an entry a Template Package import produced. */
	origin?: BroadcastGraphicTemplateOrigin;
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
