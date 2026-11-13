import type { ModuleOptions } from '@nuxt/fonts';
import type { GraphicFontPackage } from '../shared/modules/graphics/typography.ts';
import { GRAPHIC_FONTS } from '../shared/modules/graphics/typography.ts';

export interface ApplicationFontFamily {
	name: string;
	provider: 'npm';
	weights: number[];
	styles: ('normal' | 'italic')[];
}

/**
 * One entry per packaged definition, in registry order: the `families` Nuxt
 * Fonts resolves from each pinned Fontsource package on disk.
 *
 * Every weight and style the package ships is named, so an author can pick any
 * of them; a system stack has no package and is never asked for.
 */
export function applicationFontFamilies(): ApplicationFontFamily[] {
	return GRAPHIC_FONTS.flatMap(({ package: pkg }) => (pkg
		? packagedFamily(pkg)
		: []));
}

function packagedFamily(pkg: GraphicFontPackage): ApplicationFontFamily {
	return {
		name: pkg.family,
		provider: 'npm',
		weights: [...pkg.weights],
		styles: pkg.italic
			? ['normal', 'italic']
			: ['normal'],
	};
}

/**
 * The whole of `nuxt.config.ts`'s `fonts` block (ADR-0086).
 *
 * Application fonts come from their pinned Fontsource packages on disk, and only
 * from there: a global provider removes every other, and `remote: false` keeps
 * the npm provider off its CDN, so a build never fetches a font. A declared face
 * names no `local()` source, so every machine paints the pinned file rather than
 * an installed copy; the metric fallbacks Nuxt Fonts generates stay `local()`.
 */
export const APPLICATION_FONTS_OPTIONS = {
	provider: 'npm',
	npm: { remote: false },
	families: applicationFontFamilies(),
	experimental: { disableLocalFallbacks: true },
} satisfies ModuleOptions;

interface BuildManifestEntry {
	resourceType?: string;
	assets?: string[];
}

/**
 * Nuxt's `build:manifest` hook: font files leave the client manifest.
 *
 * Vite lists every file a stylesheet references as an asset of the chunk that
 * imports it, and Nuxt copies each into every dependent chunk's precomputed
 * dependencies, so 1,129 font files made the Worker's `precomputed.mjs` 21.6 MB.
 * The stylesheet's `@font-face` rules fetch a face when a page paints it; no font
 * here is preloaded, so the manifest entries carried nothing a page used.
 */
export function dropFontAssetsFromManifest(manifest: Record<string, BuildManifestEntry>) {
	const fonts = new Set(Object.keys(manifest).filter(key => manifest[key]!.resourceType === 'font'));
	for (const key of fonts)
		delete manifest[key];
	for (const entry of Object.values(manifest)) {
		if (entry.assets)
			entry.assets = entry.assets.filter(asset => !fonts.has(asset));
	}
}
