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
