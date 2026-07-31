import type { H3Event } from 'h3';
import type {
	FeatureMatchLayoutTemplateOrigin,
	FeatureMatchLayoutTemplateSummary,
} from '~~/shared/types/featureMatchLayoutTemplate';
import type { InstalledGraphicsTemplateSummary } from '~~/shared/types/graphicsAsset';
import type { FeatureMatchLayoutConfig } from '~~/shared/types/screenConfig';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { readInstalledFeatureMatchLayoutDocument } from '~~/server/modules/template-package-payload/featureMatchLayout';
import { featureMatchLayoutTemplateService } from '~~/server/services/featureMatchLayoutTemplate';
import { flattenGraphicItems } from '~~/shared/modules/graphics';

/**
 * The installation's Feature Match Layout Template library, from both the places
 * its entries come from.
 *
 * A layout enters the library one of two ways: an author saves a Screen's layout
 * here, or a `.sklayout` Template Package installs one. They are stored apart
 * because they are *published* apart — a saved layout is an ordinary library write,
 * while an imported one is published by Template Package Installation inside the
 * transaction that also publishes its Graphic Assets, origins, and rewritten
 * references. That transaction belongs to the Graphics Asset Library.
 *
 * The reasoning is the Broadcast Graphic Template library's, and holds for the same
 * reasons: copying an installed entry into the authored store would produce two
 * records for one design pinning the same revisions under two owner kinds, and they
 * come apart the moment anyone deletes or revises either. Reading both stores keeps
 * one design as one artifact with one identity and one set of references, and keeps
 * the import atomic — nothing at all is written after the installation transaction
 * commits.
 *
 * An imported entry cannot be renamed, described, revised, or deleted here, because
 * this library reads the Graphics Asset Library's record and never writes it. It can
 * be browsed, placed, and exported, which is what a layout is for. An author who
 * wants to change one places it and saves the placed layout.
 */

export interface FeatureMatchLayoutTemplateLibraryEntry {
	id: string;
	name: string;
	description: string | null;
	revision: number;
	document: FeatureMatchLayoutConfig;
	/** Present only on an entry a Template Package installed. */
	provenance?: FeatureMatchLayoutTemplateOrigin;
	/** Whether this installation authored the entry, and so may revise or delete it. */
	authored: boolean;
	createdAt: Date;
	updatedAt: Date;
}

function installedEntry(
	template: InstalledGraphicsTemplateSummary,
): FeatureMatchLayoutTemplateLibraryEntry | undefined {
	const document = readInstalledFeatureMatchLayoutDocument(template.document);
	// A stored document that is not a Feature Match Layout cannot be placed,
	// exported, or counted, so it is left out of the library rather than listed as an
	// entry that fails on use. Preflight refuses one on the way in, so this is the
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
 * One listing rather than two, because "the layouts available to place" is one
 * question. Where a given layout came from is a property of the entry, not a reason
 * for an author to look somewhere else.
 */
export async function listFeatureMatchLayoutTemplateLibrary(
	event: H3Event,
): Promise<FeatureMatchLayoutTemplateLibraryEntry[]> {
	const [authored, installed] = await Promise.all([
		featureMatchLayoutTemplateService().findAll(),
		graphicsAssetLibraryForEvent(event).listInstalledGraphicsTemplates({
			kind: 'feature-match-layout',
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
export async function findFeatureMatchLayoutTemplateLibraryEntry(
	event: H3Event,
	templateId: string,
): Promise<FeatureMatchLayoutTemplateLibraryEntry | undefined> {
	const authored = await featureMatchLayoutTemplateService().findById(templateId);
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
	// A Broadcast Graphic Template is a real Installed Graphics Template and a
	// perfectly valid identity — it is simply not an entry in *this* library, and
	// answering with it would hand a caller a document it cannot place. This is the
	// read side of the two package kinds being non-interchangeable.
	return installed?.kind === 'feature-match-layout' ? installedEntry(installed) : undefined;
}

export function featureMatchLayoutTemplateLibrarySummary(
	entry: FeatureMatchLayoutTemplateLibraryEntry,
): FeatureMatchLayoutTemplateSummary {
	return {
		id: entry.id,
		name: entry.name,
		description: entry.description,
		revision: entry.revision,
		provenance: entry.provenance,
		authored: entry.authored,
		itemCount: flattenGraphicItems(entry.document.composition).length,
		sourceCount: entry.document.sources.length,
		createdAt: entry.createdAt,
		updatedAt: entry.updatedAt,
	};
}
