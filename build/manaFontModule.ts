import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { relative } from 'node:path';
import { addTemplate, defineNuxtModule } from 'nuxt/kit';
import { trimManaFontStylesheet } from './manaFontStylesheet';

const require = createRequire(import.meta.url);

/**
 * Writes `#build/mana-font.css`: `mana-font`'s class rules behind one `Mana`
 * face from the package's `woff2`, so the build ships neither `MPlantin` nor
 * the legacy formats the package's own faces name.
 *
 * Written to disk because a style block's `@import` resolves through Vite's CSS
 * resolver, which reads files rather than Nuxt's virtual templates. The `url()`
 * is relative to the build directory, where Vite rebases it from.
 */
export const manaFontModule = defineNuxtModule({
	meta: { name: 'mana-font' },
	setup(_options, nuxt) {
		addTemplate({
			filename: 'mana-font.css',
			write: true,
			getContents: () => {
				const font = relative(nuxt.options.buildDir, require.resolve('mana-font/fonts/mana.woff2'));
				const stylesheet = readFileSync(require.resolve('mana-font/css/mana.css'), 'utf8');
				return `@font-face {
  font-family: "Mana";
  src: url("${font}") format("woff2");
  font-weight: normal;
  font-style: normal;
}
${trimManaFontStylesheet(stylesheet)}`;
			},
		});
	},
});
