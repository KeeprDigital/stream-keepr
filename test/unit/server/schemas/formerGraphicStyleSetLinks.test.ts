import { describe, expect, it } from 'vitest';
import {
	broadcastGraphicConfigSchema,
	broadcastGraphicsModeConfigSchema,
	featureMatchLayoutConfigSchema,
	modeConfigPatchSchemaMap,
} from '~~/server/schemas/api/screen';
import { maximalBroadcastGraphicDocument } from '~~/test/helpers/broadcastGraphicDocument';
import { maximalFeatureMatchLayoutDocument } from '~~/test/helpers/featureMatchLayoutDocument';
import { GRAPHIC_STYLE_SET_LINK_KEYS, withFormerItemStyleRefs, withFormerStyleSetLink } from '~~/test/helpers/formerGraphicStyleSetLinks';
import { testGraphicAssetReference } from '~~/test/helpers/graphicsAssetIdentities';

// A graphics document recorded while Graphic Style Sets existed still reads, keeping its
// values as literals and losing the links; any other unknown key is still refused.

const asset = testGraphicAssetReference('asset-1', 'revision-1');
const graphic = maximalBroadcastGraphicDocument({ asset });
const layout = maximalFeatureMatchLayoutDocument({
	frameAsset: testGraphicAssetReference('frame-asset', 'frame-revision'),
	itemAsset: asset,
});

describe.each([
	{
		document: 'a Broadcast Graphic',
		parse: (value: unknown) => broadcastGraphicConfigSchema.safeParse(value),
		current: graphic,
		linked: withFormerStyleSetLink(graphic),
	},
	{
		document: 'a Broadcast Graphics Screen\'s full write',
		parse: (value: unknown) => broadcastGraphicsModeConfigSchema.safeParse(value),
		current: {
			graphics: [graphic],
		},
		linked: {
			graphics: [
				withFormerStyleSetLink(graphic),
			],
		},
	},
	{
		document: 'a Broadcast Graphics Screen\'s PATCH',
		parse: (value: unknown) => modeConfigPatchSchemaMap['broadcast-graphics'].safeParse(value),
		current: {
			graphics: [graphic],
		},
		linked: {
			graphics: [
				withFormerStyleSetLink(graphic),
			],
		},
	},
	{
		document: 'a Feature Match Layout',
		parse: (value: unknown) => featureMatchLayoutConfigSchema.safeParse(value),
		current: layout,
		linked: withFormerItemStyleRefs(layout),
	},
])('$document recorded with Graphic Style Set links', ({ parse, current, linked }) => {
	it('reads as the same document without them', () => {
		const read = parse(linked);

		expect(read.error?.issues).toBeUndefined();
		expect(JSON.stringify(read.data)).not.toMatch(GRAPHIC_STYLE_SET_LINK_KEYS);
		expect(JSON.stringify(read.data)).toBe(JSON.stringify(parse(current).data));
	});

	it('still refuses a key the document never had', () => {
		expect(parse(withFormerItemStyleRefs(JSON.parse(JSON.stringify(current).replace('"visible":', '"palette":{},"visible":')))).success).toBe(false);
	});
});
