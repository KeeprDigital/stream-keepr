import { expect, it } from 'vitest';
import { modeConfigPatchSchemaMap, parseModeConfigPatchResult } from '~~/server/schemas/api/screen';
import { resolveScreenModeConfig } from '~~/shared/types/screenConfig';
import { MODES_WITH_A_BACKGROUND_LAYER_STACK } from '~~/test/helpers/backgroundLayerModes';

const STACK = [
	{
		id: 'plate',
		type: 'image',
		enabled: true,
		opacity: 1,
		source: { kind: 'asset', assetId: 'asset-1', revisionId: 'revision-1' },
		fit: 'cover',
	},
	{
		id: 'remote',
		type: 'image',
		enabled: true,
		opacity: 1,
		source: { kind: 'url', url: 'https://example.com/plate.png' },
		fit: 'cover',
	},
];

// The two steps `PATCH …/config/:mode` takes before storage. A mode whose schema
// dropped the stack would index nothing, and its asset layer would be blank on air.
it.each(MODES_WITH_A_BACKGROUND_LAYER_STACK)('keeps a Background Layer stack through a %s PATCH into storage', (mode) => {
	const patch = modeConfigPatchSchemaMap[mode].parse({ backgroundLayers: STACK }) as Record<string, unknown>;
	const stored = parseModeConfigPatchResult({}, mode, patch);

	expect(patch).toEqual({ backgroundLayers: STACK });
	expect((resolveScreenModeConfig(stored, mode) as { backgroundLayers?: unknown }).backgroundLayers).toEqual(STACK);
});
