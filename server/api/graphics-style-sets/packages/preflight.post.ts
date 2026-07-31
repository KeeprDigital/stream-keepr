import { graphicStyleSetPackagePreflight } from '~~/server/modules/graphic-style-set-package';
import { requireGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';
import { graphicStyleSetPackagePreflightQuerySchema } from '~~/server/schemas/api/graphicStyleSetPackage';
import {
	graphicStyleSetPackagePorts,
	readGraphicStyleSetPackageBody,
} from '~~/server/utils/graphicStyleSetPackageApi';

/**
 * Inspect a received `.skstyle` package without installing anything.
 *
 * The complete reason a package can or cannot be installed, in one report: archive
 * safety, envelope limits, schema version, whether the document is a Graphic Style Set
 * this installation reads, whether its entries resolve here, and — the part only this
 * installation can answer — how the packaged identity and revision relate to what it
 * already holds.
 *
 * Every problem found is reported together. A package is a file somebody was sent, and
 * an author who has to discover its faults one round trip at a time cannot tell whether
 * the next fix is the last one.
 *
 * The report writes nothing. It is safe to run repeatedly, and its fingerprint is what
 * an installation is later bound to — so an author reads this, decides, and hands the
 * fingerprint back with the same bytes.
 */
export default defineEventHandler(async (event) => {
	await requireGraphicsAuthorSession(event);
	const query = await getValidatedQuery(event, graphicStyleSetPackagePreflightQuerySchema.parse);
	const archive = await readGraphicStyleSetPackageBody(event);

	const ports = graphicStyleSetPackagePorts();
	const { report } = await graphicStyleSetPackagePreflight({
		archive,
		resolution: query.resolution,
		sourceFileName: query.sourceFileName,
		findInstalled: ports.findInstalled,
		findLinkedTemplates: ports.findLinkedTemplates,
		now: () => new Date(),
	});

	return report;
});
