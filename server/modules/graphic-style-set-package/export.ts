import type { DbGraphicStyleSet } from '~~/server/db/schema';
import type {
	GraphicStyleSetPackageExportIssue,
	GraphicStyleSetPackageExportIssueCode,
	GraphicStyleSetPackageExportReport,
	GraphicStyleSetPackageManifest,
	GraphicStyleSetSnapshot,
} from '~~/shared/types/graphicStyleSetPackage';
import { readableBytes } from '~~/server/modules/graphics-asset-library/object-store';
import { inspectTemplateDocument } from '~~/server/modules/graphics-asset-library/template-package';
import {
	createStoredZipArchive,
	storedZipArchiveByteLength,
} from '~~/server/modules/graphics-asset-library/zip-archive';
import {
	graphicStyleSetContentDigest,
	graphicStyleSetPackageCapabilities,
	validateGraphicStyleSetDraft,
} from '~~/shared/modules/graphic-style-sets';
import {
	GRAPHIC_STYLE_SET_PACKAGE_ARTIFACT_KIND,
	GRAPHIC_STYLE_SET_PACKAGE_KIND,
	GRAPHIC_STYLE_SET_PACKAGE_LIMITS,
	GRAPHIC_STYLE_SET_PACKAGE_MANIFEST_ENTRY,
	GRAPHIC_STYLE_SET_PACKAGE_MEDIA_TYPE,
	GRAPHIC_STYLE_SET_PACKAGE_SCHEMA_VERSION,
	GRAPHIC_STYLE_SET_PACKAGE_STYLE_SET_ENTRY,
	graphicStyleSetPackageFileName,
} from '~~/shared/types/graphicStyleSetPackage';

/**
 * Freezing one published Graphic Style Set into a `.skstyle` archive.
 *
 * Every refusal is decided before a byte is written, so a rejected export never
 * produces a partial archive, and every reason is reported together — a Style Set is
 * up to two hundred entries and an author fixes them in one sitting.
 */

const ISSUE_REMEDIATION = {
	'graphic-style-set-never-published': 'A package carries what a Graphic Style Set publishes, not what it is being edited into. Publish this Graphic Style Set, then export it.',
	'graphic-style-set-unresolvable': 'The published entries do not resolve here, so no installation could publish them either. Correct the entries and publish again before exporting.',
	'undeclared-graphic-asset-dependency': 'A Graphic Style Set Package does not yet carry Graphics Asset Library content. Replace the entry\'s library selection with an application font before exporting.',
	'executable-graphic-style-set-content': 'Packages are data-only. Remove the executable value from the entry before exporting.',
	'remote-resource-dependency': 'A package cannot depend on a remote resource. Remove the remote reference from the entry before exporting.',
	'invalid-graphic-style-set-document': 'The Graphic Style Set must be plain data. Remove the unsupported value before exporting.',
	'package-expanded-limit-exceeded': `A Graphic Style Set Package may expand to at most ${GRAPHIC_STYLE_SET_PACKAGE_LIMITS.maximumExpandedByteLength} bytes. Reduce the number or size of the Style Set's entries.`,
	'package-archive-limit-exceeded': `A Graphic Style Set Package archive may be at most ${GRAPHIC_STYLE_SET_PACKAGE_LIMITS.maximumArchiveByteLength} bytes. Reduce the number or size of the Style Set's entries.`,
} as const satisfies Record<GraphicStyleSetPackageExportIssueCode, string>;

function exportIssue(
	code: GraphicStyleSetPackageExportIssueCode,
	input: { message: string; entryId?: string },
): GraphicStyleSetPackageExportIssue {
	return {
		code,
		entryId: input.entryId,
		message: input.message,
		remediation: ISSUE_REMEDIATION[code],
	};
}

/**
 * How the shared data-only inspection's findings are named for a Style Set.
 *
 * The inspection is the Template Package envelope's, because "data-only contents" is
 * one rule and proving it twice is how two answers start to disagree. Only the
 * vocabulary changes: a Style Set has entries rather than Template slots.
 */
const DOCUMENT_ISSUE_CODES = {
	'executable-template-content': 'executable-graphic-style-set-content',
	'remote-resource-dependency': 'remote-resource-dependency',
	'undeclared-graphic-asset-dependency': 'undeclared-graphic-asset-dependency',
} as const;

export interface GraphicStyleSetPackageEnvelope {
	fileName: string;
	mediaType: string;
	manifest: GraphicStyleSetPackageManifest;
	/** Exact, known before the first byte streams, so a route may publish it. */
	archiveByteLength: number;
	open: () => ReadableStream<Uint8Array>;
}

export type GraphicStyleSetPackageExportOutcome
	= | { outcome: 'exported'; package: GraphicStyleSetPackageEnvelope }
		| { outcome: 'rejected'; report: GraphicStyleSetPackageExportReport };

function encodeJson(value: unknown): Uint8Array {
	return new TextEncoder().encode(JSON.stringify(value, null, '\t'));
}

/**
 * The snapshot one export freezes.
 *
 * The *published* entries, never the draft: a draft is referentially broken for most
 * of its life, and a package carrying one would transfer something the sending
 * installation could not publish itself.
 */
export function graphicStyleSetPackageSnapshot(
	styleSet: Pick<DbGraphicStyleSet, 'id' | 'name' | 'description' | 'revision' | 'published'>,
): GraphicStyleSetSnapshot | undefined {
	if (styleSet.revision === 0 || styleSet.published === null)
		return undefined;
	return {
		id: styleSet.id,
		name: styleSet.name,
		description: styleSet.description,
		revision: styleSet.revision,
		entries: styleSet.published,
	};
}

/**
 * One published Graphic Style Set as a `.skstyle` package, or the complete reason it
 * cannot be one.
 */
export async function exportGraphicStyleSetPackage(input: {
	styleSet: Pick<DbGraphicStyleSet, 'id' | 'name' | 'description' | 'revision' | 'published'>;
	now: () => Date;
}): Promise<GraphicStyleSetPackageExportOutcome> {
	const checkedAt = input.now().toISOString();
	const reject = (issues: GraphicStyleSetPackageExportIssue[]): GraphicStyleSetPackageExportOutcome => ({
		outcome: 'rejected',
		report: {
			styleSetId: input.styleSet.id,
			checkedAt,
			issues,
			limits: GRAPHIC_STYLE_SET_PACKAGE_LIMITS,
		},
	});

	const snapshot = graphicStyleSetPackageSnapshot(input.styleSet);
	if (!snapshot) {
		return reject([exportIssue('graphic-style-set-never-published', {
			message: 'This Graphic Style Set has never been published, so there is nothing to freeze',
		})]);
	}

	const issues: GraphicStyleSetPackageExportIssue[] = [];

	// A package that could not be published where it landed is not worth producing.
	// The same resolution publish runs, over the same entries, so an exportable package
	// is one every installation with the same fonts can publish.
	const { issues: publishIssues } = validateGraphicStyleSetDraft(snapshot.entries);
	for (const publishIssue of publishIssues) {
		issues.push(exportIssue('graphic-style-set-unresolvable', {
			entryId: publishIssue.entryId,
			message: publishIssue.message,
		}));
	}

	const inspected = inspectTemplateDocument(snapshot);
	for (const documentIssue of inspected.issues) {
		issues.push(exportIssue(
			DOCUMENT_ISSUE_CODES[documentIssue.code as keyof typeof DOCUMENT_ISSUE_CODES]
			?? 'invalid-graphic-style-set-document',
			{ entryId: documentIssue.slot, message: documentIssue.message },
		));
	}
	// A Style Set carries no media selections, so any Graphic Asset Reference in one is
	// something this package kind has no place to put. Refused rather than dropped: a
	// package silently missing an asset installs a Style Set that cannot be published.
	for (const discovered of inspected.references) {
		issues.push(exportIssue('undeclared-graphic-asset-dependency', {
			entryId: discovered.path,
			message: 'This Graphic Style Set entry requires a Graphic Asset Revision a Graphic Style Set Package cannot carry',
		}));
	}

	const contentDigest = await graphicStyleSetContentDigest(snapshot.entries);
	const snapshotBytes = encodeJson(snapshot);
	const manifest: GraphicStyleSetPackageManifest = {
		schemaVersion: GRAPHIC_STYLE_SET_PACKAGE_SCHEMA_VERSION,
		packageKind: GRAPHIC_STYLE_SET_PACKAGE_KIND,
		artifactKind: GRAPHIC_STYLE_SET_PACKAGE_ARTIFACT_KIND,
		createdAt: checkedAt,
		styleSet: {
			identity: snapshot.id,
			name: snapshot.name,
			revision: snapshot.revision,
			contentDigest,
			entryCount: snapshot.entries.length,
			entry: GRAPHIC_STYLE_SET_PACKAGE_STYLE_SET_ENTRY,
		},
		applicationCapabilities: graphicStyleSetPackageCapabilities(snapshot.entries),
		totals: { entryCount: 2, expandedByteLength: 0 },
	};
	// The manifest records the expanded size it is itself part of. Re-encoding only
	// ever widens the recorded number, so this settles on a fixed point.
	let manifestBytes = encodeJson(manifest);
	for (let attempt = 0; attempt < 8; attempt += 1) {
		const expanded = manifestBytes.byteLength + snapshotBytes.byteLength;
		if (manifest.totals.expandedByteLength === expanded)
			break;
		manifest.totals.expandedByteLength = expanded;
		manifestBytes = encodeJson(manifest);
	}

	const entries = [
		{ name: GRAPHIC_STYLE_SET_PACKAGE_MANIFEST_ENTRY, byteLength: manifestBytes.byteLength },
		{ name: GRAPHIC_STYLE_SET_PACKAGE_STYLE_SET_ENTRY, byteLength: snapshotBytes.byteLength },
	];
	const archiveByteLength = storedZipArchiveByteLength(entries);
	if (manifest.totals.expandedByteLength > GRAPHIC_STYLE_SET_PACKAGE_LIMITS.maximumExpandedByteLength) {
		issues.push(exportIssue('package-expanded-limit-exceeded', {
			message: `The package would expand to ${manifest.totals.expandedByteLength} bytes`,
		}));
	}
	if (archiveByteLength > GRAPHIC_STYLE_SET_PACKAGE_LIMITS.maximumArchiveByteLength) {
		issues.push(exportIssue('package-archive-limit-exceeded', {
			message: `The package archive would be ${archiveByteLength} bytes`,
		}));
	}

	if (issues.length > 0)
		return reject(issues);

	return {
		outcome: 'exported',
		package: {
			fileName: graphicStyleSetPackageFileName(snapshot.name),
			mediaType: GRAPHIC_STYLE_SET_PACKAGE_MEDIA_TYPE,
			manifest,
			archiveByteLength,
			open: () => createStoredZipArchive([
				{
					name: GRAPHIC_STYLE_SET_PACKAGE_MANIFEST_ENTRY,
					byteLength: manifestBytes.byteLength,
					open: async () => readableBytes(manifestBytes),
				},
				{
					name: GRAPHIC_STYLE_SET_PACKAGE_STYLE_SET_ENTRY,
					byteLength: snapshotBytes.byteLength,
					open: async () => readableBytes(snapshotBytes),
				},
			]),
		},
	};
}
