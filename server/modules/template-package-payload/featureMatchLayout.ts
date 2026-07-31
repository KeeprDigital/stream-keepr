import type { FeatureMatchLayoutConfig } from '~~/shared/types/screenConfig';
import type {
	TemplatePackagePayload,
	TemplatePackagePayloadIssue,
} from '~~/shared/types/templatePackage';
import { featureMatchLayoutConfigSchema } from '~~/server/schemas/api/screen';
import { featureMatchLayoutTemplatePackageRequirements } from '~~/shared/utils/templatePackageRequirements';

/**
 * The `.sklayout` payload: one Feature Match Layout Template.
 *
 * Reading a received document goes through `featureMatchLayoutConfigSchema` — the
 * same schema the Screen's own Feature Match Overlay write path uses, not a second
 * copy of it. That identity is what makes an installed layout placeable: a document
 * this accepts is a document a Screen will store, so an import cannot produce a
 * Template that fails the first time somebody places it.
 *
 * ## What "Event identities stripped" means here
 *
 * A Feature Match Layout is the Frame, the Source Items, and one composition, and
 * none of the three names anything belonging to an Event. The Feature Match Slot a
 * Screen renders lives beside the layout on the mode configuration, never inside
 * it; a Source Item declares a Source Role rather than a camera; a Graphic Text
 * Template binds a Feature Match token rather than a Player. So stripping is
 * structural — there is nothing to remove on the way out — and the schema being
 * `.strict()` is what keeps it true on the way in: a document carrying a
 * `featureMatchId`, or any other field a layout has no room for, is refused rather
 * than installed with the extra silently dropped.
 *
 * ## What the declared capabilities are for
 *
 * A layout leans on the host far more than a Broadcast Graphic does. Its Source
 * Roles, its Frame animation effect, and the Feature Match tokens its text binds
 * are all vocabulary the receiving installation supplies; the package carries only
 * the terms. Deriving them here with the same walk the exporting workflow declares
 * them with is what holds a manifest to what its document actually requires — a
 * package naming a term this installation does not implement is refused at
 * preflight, before an asset, an origin, or a Template exists.
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

function readFeatureMatchLayoutDocument(document: unknown):
	| { outcome: 'read'; document: FeatureMatchLayoutConfig }
	| { outcome: 'rejected'; issues: TemplatePackagePayloadIssue[] } {
	const parsed = featureMatchLayoutConfigSchema.safeParse(document);
	if (parsed.success)
		return { outcome: 'read', document: parsed.data as FeatureMatchLayoutConfig };

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

export const featureMatchLayoutTemplatePackagePayload: TemplatePackagePayload = {
	packageKind: 'sklayout',

	readInstallableDocument(document) {
		const read = readFeatureMatchLayoutDocument(document);
		if (read.outcome === 'rejected')
			return read;
		// Assets are deliberately not re-derived: the envelope already reconciles the
		// document's Graphic Asset References against the packaged assets, in the
		// sender's identities, and doing it twice in two vocabularies is how the two
		// answers start to disagree.
		return {
			outcome: 'read',
			capabilities: featureMatchLayoutTemplatePackageRequirements(read.document).capabilities,
		};
	},
};

/**
 * The received document as a Feature Match Layout, for a reader that already holds
 * one and needs it typed rather than proved again.
 *
 * An Installed Graphics Template stores its document as opaque data — the Graphics
 * Asset Library never interpreted it — so every reader of one has to say what it
 * expects it to be. Going through the same parse means a stored document that
 * somehow is not a Feature Match Layout is reported as such rather than cast into
 * one and left to fail somewhere further along.
 */
export function readInstalledFeatureMatchLayoutDocument(
	document: unknown,
): FeatureMatchLayoutConfig | undefined {
	const read = readFeatureMatchLayoutDocument(document);
	return read.outcome === 'read' ? read.document : undefined;
}
