/**
 * The one place an acceptance harness crosses into the repository's
 * TypeScript.
 *
 * A Screen Output only authorizes the Graphic Asset Revisions its published
 * layout references, so provisioning one means publishing a complete Feature
 * Match Layout, and proving publication atomicity means rewriting a real
 * exported Template Package. Copying either into the harness would create a
 * second definition that silently rots, so the harness loads the
 * installation's own default layout and the package fixture writer the
 * Template Package tests already use. Node strips the types; the hook below
 * only teaches it the extensionless relative specifiers and `~~/` root alias
 * that the rest of the repository is built with.
 */

import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = new URL('../../', import.meta.url);

registerHooks({
	resolve(specifier, context, next) {
		const aliased = specifier.startsWith('~~/')
			? new URL(specifier.slice(3), repositoryRoot).href
			: specifier;
		if (!/^(?:[./]|file:)/.test(aliased))
			return next(specifier, context);
		const base = new URL(aliased, context.parentURL);
		const path = fileURLToPath(base);
		for (const candidate of [`${path}.ts`, `${path}/index.ts`]) {
			if (existsSync(candidate))
				return next(pathToFileURL(candidate).href, context);
		}
		return next(base.href, context);
	},
});

const { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } = await import(
	new URL('shared/featureMatchOverlayPresets.ts', repositoryRoot).href,
);

/** The same stored-ZIP reader and writer the Template Package tests rewrite packages with. */
export const { readTemplatePackageParts, writeTemplatePackage } = await import(
	new URL('test/helpers/templatePackageArchive.ts', repositoryRoot).href,
);

/** A complete, publishable Feature Match Layout with one pinned reference. */
export function featureMatchLayoutReferencing({ assetId, revisionId }) {
	const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
	config.layout.frame.backgroundImage = { assetId, revisionId };
	return config.layout;
}

/** The same layout with every Graphic Asset reference removed. */
export function featureMatchLayoutWithoutReferences() {
	return structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG).layout;
}

const { getGraphicItemDefinition } = await import(
	new URL('shared/modules/graphics/index.ts', repositoryRoot).href,
);

/**
 * A layout that pins a VP9-alpha silent video, declared for the only target
 * that may play it.
 *
 * A silent-video reference will not index at all unless it carries the pinned
 * revision's own target compatibility, so this is the shape a Screen Output
 * has to be in before its capability-session bootstrap has any reason to
 * refuse a Safari user agent.
 */
export function featureMatchLayoutWithRestrictedVideo({ assetId, revisionId }) {
	const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
	config.layout.composition.items.push({
		...getGraphicItemDefinition('media').createDefault({
			id: 'acceptance-restricted-video',
			label: 'Acceptance VP9 alpha',
			canvasWidth: 1920,
			canvasHeight: 1080,
		}),
		mediaKind: 'silent-video',
		asset: { assetId, revisionId },
		videoCompatibility: 'chromium-transparency',
	});
	return config.layout;
}
