import type { InstalledGraphicsTemplate } from '~~/shared/types/graphicsAsset';
import type { TemplatePackageKind, TemplatePackagePayload } from '~~/shared/types/templatePackage';
import { broadcastGraphicTemplatePackagePayload } from './broadcastGraphic';
import { featureMatchLayoutTemplatePackagePayload } from './featureMatchLayout';

/**
 * Every Template Package kind's payload, in one place.
 *
 * {@link TemplatePackagePayload} states what a payload is and why the seam exists.
 * This module is the registry the application wires: the Graphics Asset Library is
 * handed {@link templatePackagePayloads} and stays a library that knows nothing
 * about Broadcast Graphics, while the Template Package installation route reaches
 * {@link adoptInstalledGraphicsTemplate} to put the result into the library its
 * artifact belongs to.
 *
 * Adoption is deliberately *not* part of the shared payload contract. The Graphics
 * Asset Library never performs it — it publishes an Installed Graphics Template and
 * stops — so putting it on the contract would hand the library a method it must
 * never call, which is how a library ends up owning a lifecycle it does not own.
 *
 * Adding a package kind means one entry in each map here. Both are total over
 * {@link TemplatePackageKind}, so the envelope cannot grow a kind without one.
 */

const PAYLOADS = {
	skgraphic: broadcastGraphicTemplatePackagePayload,
	sklayout: featureMatchLayoutTemplatePackagePayload,
} as const satisfies Record<TemplatePackageKind, TemplatePackagePayload>;

export function templatePackagePayloads(kind: TemplatePackageKind): TemplatePackagePayload {
	return PAYLOADS[kind];
}

export interface AdoptInstalledGraphicsTemplateInput {
	/** The Installed Graphics Template exactly as the atomic installation published it. */
	installed: InstalledGraphicsTemplate;
	/**
	 * The source Template revision the package declared, where it declared one.
	 *
	 * Provenance only, alongside {@link InstalledGraphicsTemplate.sourceTemplateIdentity}:
	 * it recognises a related package on a later import and is never an update link
	 * back to the installation that exported it.
	 */
	sourceTemplateRevision?: number;
}

export type AdoptInstalledGraphicsTemplate
	= (input: AdoptInstalledGraphicsTemplateInput) => Promise<void>;

/**
 * How one committed Installed Graphics Template becomes an entry in the library its
 * artifact belongs to, per package kind.
 *
 * Every adoption must be idempotent. The installation endpoint answers a repeat with
 * the installation that already committed rather than publishing a second one, so a
 * retried request reaches adoption again over the same Installed Graphics Template
 * and must not produce a second library entry.
 *
 * `undefined` for a kind with no library of its own yet.
 */
const ADOPTIONS = {
	skgraphic: broadcastGraphicTemplatePackagePayload.adoptInstalledTemplate,
	sklayout: undefined,
} as const satisfies Record<TemplatePackageKind, AdoptInstalledGraphicsTemplate | undefined>;

export async function adoptInstalledGraphicsTemplate(
	kind: TemplatePackageKind,
	input: AdoptInstalledGraphicsTemplateInput,
): Promise<void> {
	await ADOPTIONS[kind]?.(input);
}
