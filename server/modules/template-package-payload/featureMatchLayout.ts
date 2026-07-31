import type { TemplatePackagePayload } from '~~/shared/types/templatePackage';

/**
 * The `.sklayout` payload: one Feature Match Layout Template.
 *
 * Deliberately minimal, and the reason is ownership rather than oversight. Feature
 * Match Layout Template portability is its own ticket (#80): it settles what a
 * `.sklayout` document is once Event identities are stripped and a canonical sample
 * dataset travels with it, and there is no Feature Match Layout Template library to
 * adopt into until it builds one. Guessing at either here would pin a shape that
 * ticket then has to unpick.
 *
 * What this does register is the honest current position: a `.sklayout` document is
 * carried under the envelope's own rules — data-only, self-contained, every packaged
 * asset accounted for — and nothing beyond that is claimed about it. It declares no
 * capability requirements of its own, so the manifest's declarations are checked for
 * support (which they already are) but not for completeness.
 *
 * That asymmetry is visible on purpose. A `.skgraphic` is held to its vocabulary and
 * a `.sklayout` is not yet, and the difference should be a thing somebody reads here
 * rather than a silence they have to infer from an absent entry in the registry.
 */
export const featureMatchLayoutTemplatePackagePayload: TemplatePackagePayload = {
	packageKind: 'sklayout',
	readInstallableDocument() {
		return { outcome: 'read', capabilities: [] };
	},
};
