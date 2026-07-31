import type { DbGraphicStyleSet } from '~~/server/db/schema';
import type { AffectedGraphicsTemplate, GraphicStyleSetEntry } from '~~/shared/types/graphicStyleSet';
import type { GraphicStyleSetPackagePreflightReport } from '~~/shared/types/graphicStyleSetPackage';
import type { GraphicStyleSetPackagePreflightInput } from './preflight';
import { graphicStyleSetPackagePreflight } from './preflight';

/**
 * Turning one confirmed Graphic Style Set Package preflight report into local state.
 *
 * ## Why this re-runs preflight rather than trusting a stored one
 *
 * A Template Package stages its bytes durably and records its report beside them,
 * because the bytes are large and the operation is resumable. A `.skstyle` is two small
 * JSON files and nothing about it is resumable, so the archive travels with the
 * installation request and this re-derives the report from it. The author's
 * confirmation is a fingerprint, and a fingerprint covers the received bytes, the
 * resolution asked for, the disposition produced, and every issue that disposition
 * carries — so re-deriving it is a *stronger* guarantee than reading a stored report
 * back: a package whose bytes, or whose relation to this library, changed since the
 * author looked cannot inherit their confirmation.
 *
 * ## Why atomicity needs no transaction here
 *
 * "A package referencing something unsupported must fail with nothing half-installed"
 * is the same requirement a Template Package meets with one publication transaction
 * over assets, origins, references, and a template. A Graphic Style Set Package
 * installs exactly one row and nothing else — it carries no Graphic Assets, creates no
 * references, and rewrites no template — so every disposition below is a single
 * statement. There is no partial state to prevent, because there is no second write to
 * be inconsistent with.
 *
 * What a single statement does *not* settle is whether the library still looks the way
 * the report described it, so every write here is conditional on the fact its
 * disposition was chosen from. An update is conditional on the exact revision and draft
 * revision the *report* recorded — never on a fresh read, which would only ever guard
 * the moment between that read and the write — because a concurrent publish or draft
 * edit would otherwise install entries over something the author never saw. A creation
 * is conditional on the packaged identity still being unheld, because a concurrent
 * install of the same package would otherwise turn a modelled conflict into a
 * primary-key violation. A write that matches nothing installs nothing, and both answer
 * with `conflict`.
 */

export interface GraphicStyleSetPackageInstallPorts {
	findInstalled: GraphicStyleSetPackagePreflightInput['findInstalled'];
	findLinkedTemplates: GraphicStyleSetPackagePreflightInput['findLinkedTemplates'];
	/** The stored Graphic Style Set itself, for the response an install answers with. */
	findInstalledRow: (styleSetId: string) => Promise<DbGraphicStyleSet | undefined>;
	/**
	 * Creates a Graphic Style Set published at the entries and revision given, but only
	 * while that identity is still unheld. Resolves undefined when it is not.
	 */
	createPublished: (input: {
		id: string;
		name: string;
		description: string | null;
		revision: number;
		entries: GraphicStyleSetEntry[];
	}) => Promise<DbGraphicStyleSet | undefined>;
	/**
	 * Publishes the entries over an installed Graphic Style Set, but only while it is
	 * still at the revision and draft revision the proposal was decided against.
	 * Resolves undefined when it is not.
	 */
	republish: (input: {
		id: string;
		revision: number;
		entries: GraphicStyleSetEntry[];
		expectedRevision: number;
		expectedDraftRevision: number;
	}) => Promise<DbGraphicStyleSet | undefined>;
	newIdentity: () => string;
}

export type GraphicStyleSetPackageInstallOutcome
	= | {
		outcome: 'installed';
		report: GraphicStyleSetPackagePreflightReport;
		styleSet: DbGraphicStyleSet;
		affectedTemplates: readonly AffectedGraphicsTemplate[];
	}
	/** The exact identity, revision, and content were already installed. Nothing was written. */
	| {
		outcome: 'already-installed';
		report: GraphicStyleSetPackagePreflightReport;
		styleSet: DbGraphicStyleSet;
	}
	| { outcome: 'rejected'; report: GraphicStyleSetPackagePreflightReport }
	/** The proposal carries warnings and no confirmation covers this exact fingerprint. */
	| { outcome: 'requires-confirmation'; report: GraphicStyleSetPackagePreflightReport }
	/**
	 * The library moved between the report and the write — the installed Style Set was
	 * published, edited, or deleted, or the packaged identity this was about to create
	 * was claimed. Nothing was written, and a fresh report shows the library as it now
	 * stands.
	 */
	| { outcome: 'conflict'; report: GraphicStyleSetPackagePreflightReport };

export interface InstallGraphicStyleSetPackageInput
	extends Omit<GraphicStyleSetPackagePreflightInput, 'findInstalled' | 'findLinkedTemplates'> {
	ports: GraphicStyleSetPackageInstallPorts;
	/**
	 * The fingerprint the author confirmed, where the proposal needs one. A report that
	 * needs no confirmation installs without it; a report that does installs only under
	 * the exact fingerprint it produced.
	 */
	confirmedFingerprint?: string;
}

export async function installGraphicStyleSetPackage(
	input: InstallGraphicStyleSetPackageInput,
): Promise<GraphicStyleSetPackageInstallOutcome> {
	const { ports } = input;
	const { report, snapshot } = await graphicStyleSetPackagePreflight({
		archive: input.archive,
		resolution: input.resolution,
		sourceFileName: input.sourceFileName,
		findInstalled: ports.findInstalled,
		findLinkedTemplates: ports.findLinkedTemplates,
		now: input.now,
	});

	if (report.outcome === 'rejected' || !snapshot)
		return { outcome: 'rejected', report };
	if (report.outcome === 'requires-confirmation' && input.confirmedFingerprint !== report.fingerprint)
		return { outcome: 'requires-confirmation', report };

	switch (report.disposition) {
		case 'already-installed': {
			// Deliberately no write at all. Re-publishing identical entries would advance
			// the draft revision and the updated-at of a Style Set nothing about has
			// changed, and would make a repeated import look like an edit to every author
			// watching the library.
			const installed = await ports.findInstalledRow(snapshot.id);
			return installed
				? { outcome: 'already-installed', report, styleSet: installed }
				: { outcome: 'conflict', report };
		}

		case 'install-new': {
			// Preflight found the packaged identity unheld, and the creation is conditional
			// on it still being unheld. A concurrent install of the same package, or an
			// author creating a Style Set, is the same race an update guards against — and
			// answered the same way, rather than as a constraint violation nobody modelled.
			const styleSet = await ports.createPublished({
				id: snapshot.id,
				name: snapshot.name,
				description: snapshot.description,
				revision: snapshot.revision,
				entries: snapshot.entries,
			});
			if (!styleSet)
				return { outcome: 'conflict', report };
			return { outcome: 'installed', report, styleSet, affectedTemplates: [] };
		}

		case 'install-independent-copy': {
			// A new identity, and revision one: this is the first published revision of an
			// artifact that did not exist a moment ago. Claiming the packaged revision
			// would give a Style Set a history it never had, and the packaged identity and
			// revision are already recorded on the report as the provenance of the copy.
			const styleSet = await ports.createPublished({
				id: ports.newIdentity(),
				name: snapshot.name,
				description: snapshot.description,
				revision: 1,
				entries: snapshot.entries,
			});
			// A minted identity should never be held, so this is unreachable rather than
			// expected — but it is reported as the conflict it is, because the alternative
			// is asserting a uniqueness this module does not own.
			if (!styleSet)
				return { outcome: 'conflict', report };
			return { outcome: 'installed', report, styleSet, affectedTemplates: [] };
		}

		case 'update-installed': {
			// Both preconditions come from the report, so the window they guard is the
			// whole time since the author read it. Taking either from a fresh read would
			// guard only the microseconds after that read — and the draft revision is
			// precisely what stops an edit made in the meantime being replaced by the
			// packaged entries without anybody having agreed to it.
			if (report.installedRevision === undefined || report.installedDraftRevision === undefined)
				return { outcome: 'conflict', report };
			const republished = await ports.republish({
				id: snapshot.id,
				revision: snapshot.revision,
				entries: snapshot.entries,
				expectedRevision: report.installedRevision,
				expectedDraftRevision: report.installedDraftRevision,
			});
			if (!republished)
				return { outcome: 'conflict', report };
			// Named rather than counted, and named as the report named them: an author who
			// has just made an update available on four designs needs to know which four.
			return {
				outcome: 'installed',
				report,
				styleSet: republished,
				affectedTemplates: report.affectedTemplates,
			};
		}

		case 'rejected':
			return { outcome: 'rejected', report };
	}
}
