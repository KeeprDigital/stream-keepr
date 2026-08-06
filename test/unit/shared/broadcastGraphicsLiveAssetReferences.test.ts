import type { BroadcastGraphicsLiveState } from '~~/shared/modules/broadcast-graphics-live-session';
import type {
	BroadcastGraphicConfig,
	GraphicInputDeclaration,
	MediaGraphicInputValue,
} from '~~/shared/types/graphics';
import type { BroadcastGraphicsModeConfig } from '~~/shared/types/screenConfig';
import { describe, expect, it } from 'vitest';
import { broadcastGraphicsLiveSessionGraphicAssetReferences } from '~~/shared/modules/broadcast-graphics-live-session';

/**
 * A media Graphic Input value an operator chooses at runtime lives in the Broadcast
 * Graphics Live Session rather than in authored configuration, so the Screen Output
 * Asset Capability cannot be derived from `modeConfigs` alone. It is derived from
 * the Live Session's *accepted* values, and from nothing else it holds: a staged
 * edit is not on air, and a revision an acceptance replaced stops being publishable
 * the moment it does (#96).
 */

function value(assetId: string, revisionId: string, overrides: Partial<MediaGraphicInputValue> = {}) {
	return {
		assetId,
		revisionId,
		...overrides,
	} as MediaGraphicInputValue;
}

const sponsor = value('image-asset', 'image-revision-1');
const replacement = value('image-asset', 'image-revision-2');
const sting = value('video-asset', 'video-revision-1', { videoCompatibility: 'chromium-transparency' });

function mediaInput(key: string, mediaKind: 'image' | 'silent-video' = 'image'): GraphicInputDeclaration {
	return { type: 'media', key, label: key, required: false, updatePolicy: 'staged', mediaKind, default: null };
}

function config(inputs: GraphicInputDeclaration[]): BroadcastGraphicsModeConfig {
	return {
		graphics: [{
			id: 'lower-third',
			name: 'Lower Third',
			items: [],
			inputs,
		} as unknown as BroadcastGraphicConfig],
	} as BroadcastGraphicsModeConfig;
}

function state(inputs: Record<string, unknown>): BroadcastGraphicsLiveState {
	return { graphics: {}, inputs: { 'lower-third': inputs } } as unknown as BroadcastGraphicsLiveState;
}

describe('broadcast Graphics Live Session Graphic Asset References', () => {
	it('publishes an accepted media value, named by the Graphic Input that chose it', () => {
		const references = broadcastGraphicsLiveSessionGraphicAssetReferences(
			config([mediaInput('backdrop')]),
			state({ working: {}, accepted: { backdrop: sponsor }, acceptedRevision: 1 }),
		);

		expect(references).toEqual([{
			reference: { assetId: 'image-asset', revisionId: 'image-revision-1' },
			ownerSlot: 'liveSession.lower-third.inputs.backdrop',
			kind: 'image',
		}]);
	});

	it('does not publish a staged value nothing has accepted', () => {
		// The whole failure this exists to prevent is an output resolving media that is
		// not on air. A working value is an edit in progress, and Live Control shows it
		// long before any acceptance — publishing it would open exactly that hole.
		expect(broadcastGraphicsLiveSessionGraphicAssetReferences(
			config([mediaInput('backdrop')]),
			state({ working: { backdrop: sponsor }, accepted: {}, acceptedRevision: 0 }),
		)).toEqual([]);
	});

	it('stops publishing a revision a later acceptance replaced', () => {
		expect(broadcastGraphicsLiveSessionGraphicAssetReferences(
			config([mediaInput('backdrop')]),
			state({ working: {}, accepted: { backdrop: replacement }, acceptedRevision: 2 }),
		)).toEqual([{
			reference: { assetId: 'image-asset', revisionId: 'image-revision-2' },
			ownerSlot: 'liveSession.lower-third.inputs.backdrop',
			kind: 'image',
		}]);
	});

	it('carries an accepted silent-video value’s recorded target compatibility', () => {
		expect(broadcastGraphicsLiveSessionGraphicAssetReferences(
			config([mediaInput('sting', 'silent-video')]),
			state({ working: {}, accepted: { sting }, acceptedRevision: 1 }),
		)).toEqual([{
			reference: { assetId: 'video-asset', revisionId: 'video-revision-1' },
			ownerSlot: 'liveSession.lower-third.inputs.sting',
			kind: 'silent-video',
			videoCompatibility: 'chromium-transparency',
			videoTarget: 'chromium',
		}]);
	});

	it('publishes nothing for an accepted value whose Graphic Input is no longer declared', () => {
		// Acceptance bounds what the Live Session stores, but a declaration removed by a
		// later authored write leaves values behind. A Screen publishes what it declares.
		expect(broadcastGraphicsLiveSessionGraphicAssetReferences(
			config([]),
			state({ working: {}, accepted: { backdrop: sponsor }, acceptedRevision: 1 }),
		)).toEqual([]);
	});

	/**
	 * The declared kind is not a guarantee about the stored value. A value that
	 * violates its declaration is stored rather than coerced, so a media Graphic Input
	 * can be holding a string an earlier declaration left behind — and publishing it
	 * would put a reference built out of `undefined` ids into the Screen's index.
	 */
	it('publishes nothing for a media Graphic Input holding something that is not a media value', () => {
		expect(broadcastGraphicsLiveSessionGraphicAssetReferences(
			config([mediaInput('backdrop')]),
			state({
				working: {},
				accepted: { backdrop: 'a value an earlier declaration left behind' },
				acceptedRevision: 1,
			}),
		)).toEqual([]);
	});

	it('publishes nothing for a non-media Graphic Input, whatever its accepted value looks like', () => {
		expect(broadcastGraphicsLiveSessionGraphicAssetReferences(
			config([{ type: 'text', key: 'name', label: 'Name', required: false, updatePolicy: 'staged', default: '', maxLength: 40 }]),
			state({ working: {}, accepted: { name: sponsor as unknown as string }, acceptedRevision: 1 }),
		)).toEqual([]);
	});
});
