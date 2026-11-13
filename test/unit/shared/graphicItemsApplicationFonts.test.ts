import type { GraphicItemConfig, GraphicPlaceholderStyle, GraphicTypography } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import { DEFAULT_GRAPHIC_TYPOGRAPHY } from '~~/shared/modules/graphics';
import { applicationGraphicFont } from '~~/shared/types/graphics';
import { graphicItemsApplicationFonts } from '~~/shared/utils/graphicsAssetReferences';
import { ASSET, group, shape, text } from '~~/test/helpers/graphicsComposition';

// The application faces a graphics host waits for are the faces its items paint: a
// Graphic Placeholder Style inherits what it leaves unset from the item's base typography.

const INTER_BOLD: GraphicTypography = {
	...DEFAULT_GRAPHIC_TYPOGRAPHY,
	font: applicationGraphicFont('inter'),
	fontWeight: 700,
	fontStyle: 'normal',
};
const LIBRARY_BOLD: GraphicTypography = {
	...INTER_BOLD,
	font: { kind: 'asset', reference: ASSET },
};

function styled(typography: GraphicTypography, style?: GraphicPlaceholderStyle): GraphicItemConfig {
	return text('headline', {
		typography,
		...(style
			? {
					placeholderStyles: { player: style },
				}
			: {}),
	});
}

describe('graphicItemsApplicationFonts', () => {
	it.each([
		{
			row: 'base typography',
			items: [
				styled(INTER_BOLD),
			],
			faces: [
				{ fontId: 'inter', weight: 700, style: 'normal' },
			],
		},
		{
			row: 'a library font',
			items: [
				styled(LIBRARY_BOLD),
			],
			faces: [],
		},
		{
			row: 'an item without typography',
			items: [
				shape('bar'),
			],
			faces: [],
		},
		{
			row: 'a group child',
			items: [
				group('cluster', [
					text('badge', {
						typography: { ...INTER_BOLD, fontWeight: 900 },
					}),
				]),
			],
			faces: [
				{ fontId: 'inter', weight: 900, style: 'normal' },
			],
		},
		{
			row: 'a placeholder font, inheriting weight and style',
			items: [
				styled({ ...INTER_BOLD, fontStyle: 'italic' }, {
					font: applicationGraphicFont('oswald'),
				}),
			],
			faces: [
				{ fontId: 'inter', weight: 700, style: 'italic' },
				{ fontId: 'oswald', weight: 700, style: 'italic' },
			],
		},
		{
			row: 'a placeholder weight and style, inheriting the font',
			items: [
				styled(INTER_BOLD, { fontWeight: 300, fontStyle: 'italic' }),
			],
			faces: [
				{ fontId: 'inter', weight: 700, style: 'normal' },
				{ fontId: 'inter', weight: 300, style: 'italic' },
			],
		},
		{
			row: 'a placeholder weight over a library font',
			items: [
				styled(LIBRARY_BOLD, { fontWeight: 300 }),
			],
			faces: [],
		},
		{
			row: 'a placeholder application font over a library font',
			items: [
				styled(LIBRARY_BOLD, {
					font: applicationGraphicFont('poppins'),
				}),
			],
			faces: [
				{ fontId: 'poppins', weight: 700, style: 'normal' },
			],
		},
	])('$row', ({ items, faces }) => {
		expect(graphicItemsApplicationFonts(items)).toEqual(faces);
	});
});
