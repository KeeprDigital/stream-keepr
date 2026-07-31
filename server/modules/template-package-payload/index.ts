import type { TemplatePackageKind, TemplatePackagePayload } from '~~/shared/types/templatePackage';
import { broadcastGraphicTemplatePackagePayload } from './broadcastGraphic';
import { featureMatchLayoutTemplatePackagePayload } from './featureMatchLayout';

/**
 * Every Template Package kind's payload, in one place.
 *
 * {@link TemplatePackagePayload} states what a payload is and why the seam exists.
 * This module is the registry the application wires: the Graphics Asset Library is
 * handed {@link templatePackagePayloads} and stays a library that knows nothing
 * about Broadcast Graphics.
 *
 * Adding a package kind means one entry here. The map is total over
 * {@link TemplatePackageKind}, so the envelope cannot grow a kind without one.
 */

const PAYLOADS = {
	skgraphic: broadcastGraphicTemplatePackagePayload,
	sklayout: featureMatchLayoutTemplatePackagePayload,
} as const satisfies Record<TemplatePackageKind, TemplatePackagePayload>;

export function templatePackagePayloads(kind: TemplatePackageKind): TemplatePackagePayload {
	return PAYLOADS[kind];
}
