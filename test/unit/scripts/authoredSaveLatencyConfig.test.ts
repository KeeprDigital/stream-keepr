import { describe, expect, it } from 'vitest';
import { authoredConfigForReferenceCount } from '~~/scripts/measure-authored-save-latency.mjs';
import { modeConfigPatchSchemaMap } from '~~/server/schemas/api/screen';
import { screenModeGraphicAssetReferences } from '~~/shared/utils/graphicsAssetReferences';

/**
 * The #374 probe writes real authored saves against a deployed installation, so
 * a config the schema refuses or one publishing the wrong reference count would
 * burn a production run to find. Held against the real PATCH schema and the
 * real discovery walk here instead.
 */

const assets = {
	image: { assetId: 'image-asset', revisionId: 'image-revision' },
	font: { assetId: 'font-asset', revisionId: 'font-revision' },
};

const schema = modeConfigPatchSchemaMap['broadcast-graphics'];

describe('the #374 latency probe configuration', () => {
	it.each([1, 12, 60, 150, 300, 600])(
		'passes the PATCH schema and publishes exactly %i Graphic Asset References',
		(count) => {
			const config = authoredConfigForReferenceCount(count, assets);
			const parsed = schema.parse(config);
			const references = screenModeGraphicAssetReferences(
				'broadcast-graphics',
				{ 'broadcast-graphics': parsed as never },
			);
			expect(references).toHaveLength(count);
		},
	);

	it('publishes the diagnosis mix at the documented cap: 150 media and 450 font references over 300 items', () => {
		const config = authoredConfigForReferenceCount(600, assets);
		const itemCount = config.graphics
			.reduce((total: number, graphic: { items: unknown[] }) => total + graphic.items.length, 0);
		expect(itemCount).toBe(300);
		const references = screenModeGraphicAssetReferences(
			'broadcast-graphics',
			{ 'broadcast-graphics': schema.parse(config) as never },
		);
		expect(references.filter(item => item.kind === 'image')).toHaveLength(150);
		expect(references.filter(item => item.kind === 'font')).toHaveLength(450);
	});

	it('still publishes the exact count without a font Graphic Asset, from media alone', () => {
		const config = authoredConfigForReferenceCount(60, { image: assets.image });
		const references = screenModeGraphicAssetReferences(
			'broadcast-graphics',
			{ 'broadcast-graphics': schema.parse(config) as never },
		);
		expect(references).toHaveLength(60);
		expect(references.every(item => item.kind === 'image')).toBe(true);
	});
});
