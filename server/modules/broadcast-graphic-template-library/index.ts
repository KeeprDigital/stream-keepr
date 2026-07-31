import type { H3Event } from 'h3';
import type {
	BroadcastGraphicTemplateOrigin,
	BroadcastGraphicTemplateSummary,
} from '~~/shared/types/broadcastGraphicTemplate';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { InstalledGraphicsTemplateSummary } from '~~/shared/types/graphicsAsset';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { readInstalledBroadcastGraphicDocument } from '~~/server/modules/template-package-payload/broadcastGraphic';
import { broadcastGraphicTemplateService } from '~~/server/services/broadcastGraphicTemplate';
import { flattenGraphicItems } from '~~/shared/modules/graphics';

/**
 * The installation's Broadcast Graphic Template library, from both the places its
 * entries come from.
 *
 * A design enters the library one of two ways: an author saves a placed Broadcast
 * Graphic here, or a Template Package installs one. They are stored apart because
 * they are *published* apart — a saved design is an ordinary library write, while an
 * imported one is published by Template Package Installation inside the transaction
 * that also publishes its Graphic Assets, origins, and rewritten references. That
 * transaction belongs to the Graphics Asset Library, which owns asset storage and
 * lifecycle and which this feature only ever consumes.
 *
 * ## Why an imported design is not copied into the authored store
 *
 * It would read more simply, and it is wrong. Copying produces two records for one
 * design, and they come apart the moment anyone touches either:
 *
 * - Both would pin the same revisions, under two owner kinds. Deleting the copy an
 *   author can see removes only that owner's Graphic Asset References; the Installed
 *   Graphics Template keeps pinning those revisions, and nothing exposes a way to
 *   remove one. The assets become permanently unreleasable, with no artifact an
 *   author can point at to explain why.
 * - Revising the copy rewrites only the copy's references. The Installed Graphics
 *   Template goes on pinning the revisions the design used to need.
 *
 * Reading both stores instead keeps one design as one artifact with one identity and
 * one set of references, and keeps the import atomic exactly as the glossary requires
 * — nothing at all is written after the installation transaction commits.
 *
 * ## What an imported entry cannot do, and why that is honest
 *
 * An Installed Graphics Template is the Graphics Asset Library's own record, so this
 * library reads it and never writes it: an imported entry cannot be renamed,
 * described, revised, or deleted here. It can be browsed, placed, and exported, which
 * is what a design is for. An author who wants to *change* an imported design places
 * it and saves the placed copy — the same route every authored entry took, and one
 * that produces a design this installation genuinely owns.
 */

export interface BroadcastGraphicTemplateLibraryEntry {
	id: string;
	name: string;
	description: string | null;
	revision: number;
	document: BroadcastGraphicConfig;
	/** Present only on an entry a Template Package installed. */
	provenance?: BroadcastGraphicTemplateOrigin;
	/**
	 * Whether this installation authored the entry, and so may revise or delete it.
	 *
	 * Stated rather than inferred from {@link provenance} being absent, because the
	 * two answer different questions: where a design came from, and who may change
	 * it. A caller checking the wrong one is how a route ends up offering an edit it
	 * cannot perform.
	 */
	authored: boolean;
	createdAt: Date;
	updatedAt: Date;
}

function installedEntry(
	template: InstalledGraphicsTemplateSummary,
): BroadcastGraphicTemplateLibraryEntry | undefined {
	const document = readInstalledBroadcastGraphicDocument(template.document);
	// A stored document that is not a Broadcast Graphic cannot be placed, exported,
	// or counted, so it is left out of the library rather than listed as an entry
	// that fails on use. Preflight refuses one on the way in, so this is the
	// backstop for a row that predates that check or was written by something else.
	if (!document)
		return undefined;
	const installedAt = new Date(template.installedAt);
	return {
		id: template.id,
		name: template.name,
		description: null,
		revision: template.revisionNumber,
		document,
		provenance: {
			sourceTemplateIdentity: template.sourceTemplateIdentity,
			sourceTemplateRevision: template.sourceTemplateRevision ?? null,
		},
		authored: false,
		createdAt: installedAt,
		updatedAt: installedAt,
	};
}

/**
 * Every entry in the library, authored and imported together, ordered by name.
 *
 * One listing rather than two, because "the designs available to place" is one
 * question. Where a given design came from is a property of the entry, not a reason
 * for an author to look somewhere else.
 */
export async function listBroadcastGraphicTemplateLibrary(
	event: H3Event,
): Promise<BroadcastGraphicTemplateLibraryEntry[]> {
	const [authored, installed] = await Promise.all([
		broadcastGraphicTemplateService().findAll(),
		graphicsAssetLibraryForEvent(event).listInstalledGraphicsTemplates({
			kind: 'broadcast-graphic',
		}),
	]);
	return [
		...authored.map(template => ({
			id: template.id,
			name: template.name,
			description: template.description,
			revision: template.revision,
			document: template.document,
			authored: true,
			createdAt: template.createdAt,
			updatedAt: template.updatedAt,
		})),
		...installed.map(installedEntry).filter(entry => entry !== undefined),
	].sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

/**
 * One entry by identity, from whichever store holds it.
 *
 * The two identity spaces cannot collide: both are generated identifiers, and an
 * Installed Graphics Template's is minted by the installation that published it.
 * The authored store is asked first because it is the one an author writes to.
 */
export async function findBroadcastGraphicTemplateLibraryEntry(
	event: H3Event,
	templateId: string,
): Promise<BroadcastGraphicTemplateLibraryEntry | undefined> {
	const authored = await broadcastGraphicTemplateService().findById(templateId);
	if (authored) {
		return {
			id: authored.id,
			name: authored.name,
			description: authored.description,
			revision: authored.revision,
			document: authored.document,
			authored: true,
			createdAt: authored.createdAt,
			updatedAt: authored.updatedAt,
		};
	}
	const installed = await graphicsAssetLibraryForEvent(event)
		.findInstalledGraphicsTemplate({ templateId });
	// A Feature Match Layout Template is a real Installed Graphics Template and a
	// perfectly valid identity — it is simply not an entry in *this* library, and
	// answering with it would hand a caller a document it cannot place.
	return installed?.kind === 'broadcast-graphic' ? installedEntry(installed) : undefined;
}

export function broadcastGraphicTemplateLibrarySummary(
	entry: BroadcastGraphicTemplateLibraryEntry,
): BroadcastGraphicTemplateSummary {
	return {
		id: entry.id,
		name: entry.name,
		description: entry.description,
		revision: entry.revision,
		provenance: entry.provenance,
		authored: entry.authored,
		// Graphic Group children are Graphic Items in their own right and count as
		// such, exactly as they do against the Screen's own Graphic Item caps.
		itemCount: flattenGraphicItems(entry.document).length,
		inputCount: entry.document.inputs?.length ?? 0,
		createdAt: entry.createdAt,
		updatedAt: entry.updatedAt,
	};
}
