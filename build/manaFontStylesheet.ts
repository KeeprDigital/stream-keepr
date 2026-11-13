const FONT_FACE_RULE = /@font-face\s*\{[^}]*\}\s*/g;

/**
 * `mana-font`'s stylesheet with every `@font-face` rule removed.
 *
 * The package declares `MPlantin` beside `Mana`, each in `.eot`, `.woff`,
 * `.ttf` and `.svg`, so importing it as shipped puts all eight files in the
 * build; `manaFontModule` declares the one face the app needs in their place.
 */
export function trimManaFontStylesheet(css: string): string {
	return css.replace(FONT_FACE_RULE, '');
}
