import { z } from 'zod';
import { GRAPHIC_STYLE_SET_PACKAGE_RESOLUTIONS } from '~~/shared/types/graphicStyleSetPackage';

/**
 * What a caller declares beside the archive bytes it is sending.
 *
 * The archive itself is the request body, so everything an author decides about it
 * travels as query parameters. There are only three things to decide, and the shapes
 * are deliberately narrow: an import that could be steered by a rich body would be one
 * where the package and the instruction could disagree about which Style Set is being
 * installed.
 */

/**
 * How a related or conflicting package should be resolved.
 *
 * Defaulted to preserving the packaged identity, because that is what makes a Style
 * Set's revisions travel at all. Choosing an independent copy is an explicit act: it
 * produces an artifact nothing links to and that no later package can update.
 */
const resolutionSchema = z.enum(GRAPHIC_STYLE_SET_PACKAGE_RESOLUTIONS).default('preserve-identity');

/** The received file name, when the transfer had one. A hint, never the authority. */
const sourceFileNameSchema = z.string().trim().min(1).max(255).optional();

export const graphicStyleSetPackagePreflightQuerySchema = z.object({
	resolution: resolutionSchema,
	sourceFileName: sourceFileNameSchema,
});

export const graphicStyleSetPackageInstallQuerySchema = z.object({
	resolution: resolutionSchema,
	sourceFileName: sourceFileNameSchema,
	/**
	 * The preflight fingerprint the author confirmed.
	 *
	 * Optional because a proposal with nothing to weigh needs no confirmation. When a
	 * proposal does carry warnings, installation re-derives the report from the same
	 * bytes and refuses unless this is the fingerprint it produces — so a package, or a
	 * library, that changed since the author looked cannot inherit their decision.
	 */
	fingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});
