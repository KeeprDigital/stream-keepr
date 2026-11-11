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
import { FEATURE_MATCH_OVERLAY_PRESETS } from '~~/shared/featureMatchOverlayPresets';
import { flattenGraphicItems } from '~~/shared/modules/graphics';

/**
 * The installation's Feature Match Layout Template library, from every place its
 * entries come from.
 *
 * A layout enters the library one of two ways: an author saves a Screen's layout
 * here, or a `.sklayout` Template Package installs one. The built-in layouts are
 * in it from the start, and are described below. The first two are stored apart
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
 * An imported entry cannot be renamed, described, or revised here, because this
 * library reads the Graphics Asset Library's record and never writes it. It can be
 * browsed, placed, exported, and removed, the removal going through the Graphics Asset
 * Library (ADR-0068). An author who wants to change one places it and saves the placed
 * layout.
 *
 * A built-in entry is one of the layouts the application ships, the former Feature
 * Match Overlay Presets. It is stored nowhere: it is the same on every installation
 * and changes only with the application, so it is browsed and placed and nothing
 * else. It cannot be revised or removed, because there is no record to write, and it
 * is not exported, because every installation already has it.
 */

export interface FeatureMatchLayoutTemplateLibraryEntry {
	id: string;
	name: string;
	description: string | null;
	revision: number;
	document: FeatureMatchLayoutConfig;
	/** Present only on an entry a Template Package installed. */
	provenance?: FeatureMatchLayoutTemplateOrigin;
	/** Whether this installation authored the entry, and so may rename or revise it. */
	authored: boolean;
	/** Present, and true, only on an entry the application ships. */
	builtIn?: true;
	/** The canvas aspect ratio the layout was drawn for, where the entry states one. */
	aspectRatio?: number;
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
 * A built-in entry's identity is its preset id behind a prefix no generated
 * identifier can hold, so it collides with neither store's.
 */
const BUILT_IN_ID_PREFIX = 'builtin:';

/** A built-in has shipped unrevised since the application has existed. */
const BUILT_IN_SINCE = new Date(0);

function builtInEntries(): FeatureMatchLayoutTemplateLibraryEntry[] {
	return FEATURE_MATCH_OVERLAY_PRESETS.map(preset => ({
		id: `${BUILT_IN_ID_PREFIX}${preset.id}`,
		name: preset.label,
		description: preset.description,
		revision: 1,
		// Copied, so nothing a caller does to an entry reaches the layout every
		// later read is answered from.
		document: structuredClone(preset.config.layout),
		authored: false,
		builtIn: true,
		aspectRatio: preset.aspectRatio,
		createdAt: BUILT_IN_SINCE,
		updatedAt: BUILT_IN_SINCE,
	}));
}

/** The built-in entry an identity names, if it names one. */
export function findBuiltInFeatureMatchLayoutTemplate(
	templateId: string,
): FeatureMatchLayoutTemplateLibraryEntry | undefined {
	if (!templateId.startsWith(BUILT_IN_ID_PREFIX))
		return undefined;
	return builtInEntries().find(entry => entry.id === templateId);
}

/**
 * Every entry in the library, built-in, authored and imported together, ordered by
 * name.
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
		...builtInEntries(),
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
 * The identity spaces cannot collide: the stores' are generated identifiers, an
 * Installed Graphics Template's minted by the installation that published it, and
 * a built-in's carries a prefix neither generates. A built-in is answered without
 * a read; the authored store is asked next because it is the one an author writes to.
 */
export async function findFeatureMatchLayoutTemplateLibraryEntry(
	event: H3Event,
	templateId: string,
): Promise<FeatureMatchLayoutTemplateLibraryEntry | undefined> {
	const builtIn = findBuiltInFeatureMatchLayoutTemplate(templateId);
	if (builtIn)
		return builtIn;
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
	return installed?.kind === 'feature-match-layout'
		? installedEntry(installed)
		: undefined;
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
		builtIn: entry.builtIn,
		aspectRatio: entry.aspectRatio,
		itemCount: flattenGraphicItems(entry.document.composition).length,
		sourceCount: entry.document.sources.length,
		createdAt: entry.createdAt,
		updatedAt: entry.updatedAt,
	};
}
