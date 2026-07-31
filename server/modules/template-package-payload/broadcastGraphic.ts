import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type {
	TemplatePackagePayload,
	TemplatePackagePayloadIssue,
} from '~~/shared/types/templatePackage';
import type { AdoptInstalledGraphicsTemplate } from '.';
import { broadcastGraphicConfigSchema } from '~~/server/schemas/api/screen';
import { broadcastGraphicTemplatePackageRequirements } from '~~/shared/utils/templatePackageRequirements';

/**
 * The `.skgraphic` payload: one Broadcast Graphic Template.
 *
 * Reading a received document goes through `broadcastGraphicConfigSchema` — the very
 * schema a Screen's authored stack and the Broadcast Graphic Template library's own
 * writes go through, and not a second copy of it. That identity is the
 * whole point: a document this accepts is a document the library will store and the
 * Screen's write path will place, so an import cannot produce a Template that fails
 * the first time somebody tries to use it. Every bound the schema states — Graphic
 * Item id uniqueness across a Graphic Group's children, per-graphic caps, the closed
 * set of Graphic Item kinds — becomes a bound on what may be brought in from
 * another installation.
 *
 * The rejection is deliberately not a repair. A document that is nearly a Broadcast
 * Graphic is refused whole, because the alternative is guessing at what an author on
 * another installation meant and baking the guess into a design they will keep.
 */

function issue(
	code: TemplatePackagePayloadIssue['code'],
	subject: string | undefined,
	message: string,
): TemplatePackagePayloadIssue {
	return { code, subject, message };
}

/**
 * The first few schema failures, named by the field that caused them.
 *
 * Bounded because a hostile package can produce an unbounded number of them and a
 * report an author cannot read is not a better report. The count is stated so a
 * truncated list never reads as a complete one.
 */
const MAXIMUM_REPORTED_SCHEMA_ISSUES = 10;

function readBroadcastGraphicDocument(document: unknown):
	| { outcome: 'read'; document: BroadcastGraphicConfig }
	| { outcome: 'rejected'; issues: TemplatePackagePayloadIssue[] } {
	const parsed = broadcastGraphicConfigSchema.safeParse(document);
	if (parsed.success)
		return { outcome: 'read', document: parsed.data as BroadcastGraphicConfig };

	const problems = parsed.error.issues;
	const reported = problems.slice(0, MAXIMUM_REPORTED_SCHEMA_ISSUES).map(problem =>
		issue(
			'invalid-template-document',
			problem.path.length > 0 ? problem.path.join('.') : undefined,
			problem.message,
		),
	);
	if (problems.length > reported.length) {
		reported.push(issue(
			'invalid-template-document',
			undefined,
			`The Template document has ${problems.length} validation problems; the first ${reported.length} are reported`,
		));
	}
	return { outcome: 'rejected', issues: reported };
}

export const broadcastGraphicTemplatePackagePayload: TemplatePackagePayload & {
	adoptInstalledTemplate: AdoptInstalledGraphicsTemplate;
} = {
	packageKind: 'skgraphic',

	readInstallableDocument(document) {
		const read = readBroadcastGraphicDocument(document);
		if (read.outcome === 'rejected')
			return read;
		// Derived by the same walk the exporting workflow declares capabilities
		// with, so the manifest is held to exactly what an exporter here would have
		// written. Assets are deliberately not re-derived: the envelope already
		// reconciles the document's Graphic Asset References against the packaged
		// assets, in the sender's identities, and doing it twice in two vocabularies
		// is how the two answers start to disagree.
		return {
			outcome: 'read',
			capabilities: broadcastGraphicTemplatePackageRequirements(read.document).capabilities,
		};
	},

	/**
	 * Puts the installed design into the Broadcast Graphic Template library, where
	 * an author browses and places it exactly like one they authored here.
	 *
	 * It is a copy with no update link. The source Template identity and revision
	 * ride along as provenance — enough to recognise a related package on a later
	 * import, and never enough to follow: nothing re-reads them, nothing offers an
	 * update from them, and editing the entry advances this installation's own
	 * revision without consulting them.
	 *
	 * The library entry takes the Installed Graphics Template's own identity. They
	 * are one imported artifact seen from two sides — the Graphics Asset Library's
	 * record of what it published, and the design an author works with — and giving
	 * them one identity is what lets an installation result be looked up in either
	 * place without a mapping table that could go stale.
	 *
	 * The library store is reached through a deferred import so that reading a
	 * document — which is pure, and is the half every preflight runs — does not drag
	 * a database binding in behind it. Without that, this payload could only be
	 * exercised where a database exists, and the rules it enforces are exactly the
	 * ones worth testing without one.
	 */
	async adoptInstalledTemplate({ installed, sourceTemplateRevision }) {
		const { broadcastGraphicTemplateService } = await import(
			'~~/server/services/broadcastGraphicTemplate',
		);
		// Re-read rather than trust: this is the rewritten document, not the one
		// preflight proved, so it is a different artifact and gets its own proof.
		const read = readBroadcastGraphicDocument(installed.document);
		if (read.outcome === 'rejected') {
			throw new Error(
				`Installed Broadcast Graphic Template "${installed.name}" is not a valid Broadcast Graphic: ${
					read.issues.map(problem => problem.message).join('; ')
				}`,
			);
		}
		await broadcastGraphicTemplateService().adoptInstalled({
			id: installed.id,
			name: installed.name,
			description: null,
			document: read.document,
			sourceTemplateIdentity: installed.sourceTemplateIdentity,
			sourceTemplateRevision: sourceTemplateRevision ?? null,
		});
	},
};
