import type { BroadcastGraphicsLiveState } from '~~/shared/modules/broadcast-graphics-live-session';
import type {
	BroadcastGraphicConfig,
	GraphicInputDeclaration,
	MediaGraphicInputValue,
} from '~~/shared/types/graphics';
import type { BroadcastGraphicsModeConfig } from '~~/shared/types/screenConfig';
import { describe, expect, it } from 'vitest';
import { broadcastGraphicsLiveSessionGraphicAssetReferences } from '~~/shared/modules/broadcast-graphics-live-session';

// A Live Session publishes only its *accepted* media values: a staged edit is not
// on air, and a replaced revision stops being publishable when it is replaced (#96).
// Which values count as media at all (undeclared, non-media, malformed) is shared
// with the rendered walk and covered in broadcastGraphicsRenderedInputAssetReferences.

function value(assetId: string, revisionId: string) {
	return { assetId, revisionId } as MediaGraphicInputValue;
}

const sponsor = value('image-asset', 'image-revision-1');
const replacement = value('image-asset', 'image-revision-2');
const sting = value('video-asset', 'video-revision-1');

function mediaInput(key: string, mediaKind: 'image' | 'silent-video' = 'image'): GraphicInputDeclaration {
	return { type: 'media', key, label: key, required: false, updatePolicy: 'staged', mediaKind, default: null };
}

function references(inputs: GraphicInputDeclaration[], liveInputs: Record<string, unknown>) {
	const config = {
		graphics: [{ id: 'lower-third', name: 'Lower Third', items: [], inputs } as unknown as BroadcastGraphicConfig],
	} as BroadcastGraphicsModeConfig;
	const state = { graphics: {}, inputs: { 'lower-third': liveInputs } } as unknown as BroadcastGraphicsLiveState;
	return broadcastGraphicsLiveSessionGraphicAssetReferences(config, state);
}

describe('broadcast Graphics Live Session Graphic Asset References', () => {
	it.each([
		['image', mediaInput('backdrop'), { backdrop: sponsor }, 'image-asset', 'image-revision-1', 'backdrop'],
		['silent-video', mediaInput('sting', 'silent-video'), { sting }, 'video-asset', 'video-revision-1', 'sting'],
	] as const)('publishes an accepted %s value as its exact revision, named by its Graphic Input', (kind, input, accepted, assetId, revisionId, key) => {
		expect(references([input], { working: {}, accepted, acceptedRevision: 1 })).toEqual([
			{
				reference: { assetId, revisionId },
				ownerSlot: `liveSession.lower-third.inputs.${key}`,
				kind,
			},
		]);
	});

	it('does not publish a staged value nothing has accepted', () => {
		expect(references([mediaInput('backdrop')], { working: { backdrop: sponsor }, accepted: {}, acceptedRevision: 0 })).toEqual([]);
	});

	it('stops publishing a revision a later acceptance replaced', () => {
		expect(references([mediaInput('backdrop')], { working: {}, accepted: { backdrop: replacement }, acceptedRevision: 2 }))
			.toEqual([
				{
					reference: { assetId: 'image-asset', revisionId: 'image-revision-2' },
					ownerSlot: 'liveSession.lower-third.inputs.backdrop',
					kind: 'image',
				},
			]);
	});
});
