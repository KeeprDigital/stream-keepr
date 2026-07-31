import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type {
	TemplatePackagePayload,
	TemplatePackagePayloadIssue,
} from '~~/shared/types/templatePackage';
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

export const broadcastGraphicTemplatePackagePayload: TemplatePackagePayload = {
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
};

/**
 * The received document as a Broadcast Graphic, for a reader that already holds one
 * and needs it typed rather than proved again.
 *
 * An Installed Graphics Template stores its document as opaque data — the Graphics
 * Asset Library never interpreted it — so every reader of one has to say what it
 * expects it to be. Going through the same parse means a stored document that
 * somehow is not a Broadcast Graphic is reported as such rather than cast into one
 * and left to fail somewhere further along.
 */
export function readInstalledBroadcastGraphicDocument(
	document: unknown,
): BroadcastGraphicConfig | undefined {
	const read = readBroadcastGraphicDocument(document);
	return read.outcome === 'read' ? read.document : undefined;
}
