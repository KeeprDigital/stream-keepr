// Which Graphic Asset Revisions Theme Token values pin (ADR-0050): what a Theme
// or a Screen's overrides index as ordinary Graphic Asset References, and what
// a Screen's resolved tokens supply to its Screen Output Asset Capability.

import type { StoredThemeTokens, ThemeTokenType, ThemeTokenValue, ThemeTokenValueTypes } from './modules/theme/tokens';
import type { ScreenMode } from './types/enums';
import type { ScreenGraphicAssetReference } from './utils/graphicsAssetReferences';
import { resolveFoundationToken, resolveThemeTokens } from './modules/theme/resolution';
import { readTokenLiteral } from './modules/theme/tokens';
import { FOUNDATION_TOKENS } from './modules/theme/vocabulary';
import { screenModeTokens } from './screenModes';
import { themeTokenDefinition } from './themeTokens';
import { screenMediaSourceReference } from './utils/graphicsAssetReferences';

export { SCREEN_THEME_OVERRIDE_SLOT_PREFIX } from './utils/graphicsAssetReferences';

/**
 * Every Graphic Asset Revision one token value pins, each at a slot rooted at
 * `slot`: an asset token at the slot itself, a typography token's library font
 * at `<slot>.font`, and a Background Layer stack's library media at
 * `<slot>.<layer id>.source`. A disabled layer still pins, as a Screen's does.
 */
export function themeTokenValueGraphicAssetReferences(
	type: ThemeTokenType,
	value: ThemeTokenValue,
	slot: string,
): ScreenGraphicAssetReference[] {
	switch (type) {
		case 'asset': {
			const asset = value as ThemeTokenValueTypes['asset'];
			return asset
				? [{ reference: { assetId: asset.assetId, revisionId: asset.revisionId }, ownerSlot: slot, kind: asset.kind }]
				: [];
		}
		case 'typography': {
			const { font } = value as ThemeTokenValueTypes['typography'];
			return font.kind === 'asset'
				? [{ reference: font.reference, ownerSlot: `${slot}.font`, kind: 'font' }]
				: [];
		}
		case 'backgroundLayers':
			return (value as ThemeTokenValueTypes['backgroundLayers']).flatMap((layer) => {
				if (layer.type !== 'image' && layer.type !== 'video')
					return [];
				const reference = screenMediaSourceReference(layer.source);
				return reference
					? [{
							reference,
							ownerSlot: `${slot}.${layer.id}.source`,
							kind: layer.type === 'video'
								? 'silent-video' as const
								: 'image' as const,
						}]
					: [];
			});
		default:
			return [];
	}
}

/**
 * Every Graphic Asset Revision a stored token map pins: a Theme's, or a
 * Screen's overrides. Slots are `<prefix><token name>…`. A token that names a
 * Foundation Token, or that no longer reads as its type, pins nothing.
 */
export function storedThemeTokenGraphicAssetReferences(
	tokens: StoredThemeTokens,
	prefix = '',
): ScreenGraphicAssetReference[] {
	return Object.entries(tokens).flatMap(([name, stored]) => {
		const token = themeTokenDefinition(name);
		if (!token)
			return [];
		const literal = readTokenLiteral(token.definition, stored);
		return literal === undefined
			? []
			: themeTokenValueGraphicAssetReferences(token.definition.type, literal, `${prefix}${name}`);
	});
}

/**
 * The Graphic Asset Revisions a Screen's resolved Theme Tokens supply, which
 * its Screen Output Asset Capability admits: every Foundation Token, which any
 * Screen may consume, and the Mode Tokens of the mode it shows, each from its
 * override, else its Theme, else its default. A value an override shadows, and
 * a dormant override of another mode's Mode Token, supply nothing.
 */
export function screenThemeGraphicAssetReferences(
	mode: ScreenMode,
	theme: StoredThemeTokens,
	overrides: StoredThemeTokens,
): ScreenGraphicAssetReference[] {
	const modeTokens = screenModeTokens(mode);
	const { values } = resolveThemeTokens({ vocabulary: FOUNDATION_TOKENS, modeTokens, theme, overrides });
	const foundation = Object.entries(FOUNDATION_TOKENS).flatMap(([name, definition]) =>
		themeTokenValueGraphicAssetReferences(
			definition.type,
			resolveFoundationToken({ vocabulary: FOUNDATION_TOKENS, theme, overrides }, name),
			name,
		));
	const own = Object.entries(modeTokens).flatMap(([name, definition]) =>
		themeTokenValueGraphicAssetReferences(definition.type, values[name]!, name));
	return [...foundation, ...own];
}
