import type { BroadcastGraphicConfig, GraphicInputDeclaration, MediaGraphicInputValue } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import { broadcastGraphicsRenderedInputGraphicAssetReferences } from '~~/shared/modules/broadcast-graphics-live-session';

/**
 * The client-side counterpart of the Live Session's published references.
 *
 * A Broadcast Graphics Screen whose only media arrives as live-session-accepted
 * Graphic Input values publishes media that no walk over authored configuration can
 * see, so the Live workspace's capability-absent warning never fired for it (#238).
 * This is the walk that sees it, over the rendering the compositor is producing.
 */

function value(assetId: string, revisionId: string, overrides: Partial<MediaGraphicInputValue> = {}) {
	return { assetId, revisionId, ...overrides } as MediaGraphicInputValue;
}

const sponsor = value('image-asset', 'image-revision-1');
const replacement = value('image-asset', 'image-revision-2');
const sting = value('video-asset', 'video-revision-1', { videoCompatibility: 'chromium-transparency' });

function mediaInput(key: string, mediaKind: 'image' | 'silent-video' = 'image'): GraphicInputDeclaration {
	return { type: 'media', key, label: key, required: false, updatePolicy: 'staged', mediaKind, default: null };
}

function graphic(inputs: GraphicInputDeclaration[]): Pick<BroadcastGraphicConfig, 'id' | 'inputs'> {
	return { id: 'lower-third', inputs };
}

describe('broadcast Graphics rendered Graphic Input asset references', () => {
	it('finds a media value the operator chose live, which no authored walk can see', () => {
		expect(broadcastGraphicsRenderedInputGraphicAssetReferences(
			[graphic([mediaInput('backdrop')])],
			{ current: { 'lower-third': { backdrop: sponsor } } },
		)).toEqual([{
			reference: { assetId: 'image-asset', revisionId: 'image-revision-1' },
			ownerSlot: 'liveSession.lower-third.inputs.backdrop',
			kind: 'image',
		}]);
	});

	it('carries a silent-video value’s recorded target compatibility, as every other media reference does', () => {
		expect(broadcastGraphicsRenderedInputGraphicAssetReferences(
			[graphic([mediaInput('sting', 'silent-video')])],
			{ current: { 'lower-third': { sting } } },
		)).toEqual([{
			reference: { assetId: 'video-asset', revisionId: 'video-revision-1' },
			ownerSlot: 'liveSession.lower-third.inputs.sting',
			kind: 'silent-video',
			videoCompatibility: 'chromium-transparency',
			videoTarget: 'chromium',
		}]);
	});

	/**
	 * Both renderings are on program while an update cross-transitions between them, so
	 * an output that cannot resolve media is losing both — and the case only this half
	 * catches is a media Graphic Input updated to no value at all, whose old media is
	 * still on screen for the length of the update.
	 */
	it('finds the rendering an update is leaving as well as the one it is arriving at', () => {
		expect(broadcastGraphicsRenderedInputGraphicAssetReferences(
			[graphic([mediaInput('backdrop')])],
			{
				current: { 'lower-third': { backdrop: replacement } },
				outgoing: { 'lower-third': { backdrop: sponsor } },
			},
		)).toEqual([
			{
				reference: { assetId: 'image-asset', revisionId: 'image-revision-2' },
				ownerSlot: 'liveSession.lower-third.inputs.backdrop',
				kind: 'image',
			},
			{
				reference: { assetId: 'image-asset', revisionId: 'image-revision-1' },
				ownerSlot: 'liveSession.lower-third.inputs.backdrop.outgoing',
				kind: 'image',
			},
		]);
	});

	it('still finds media in a rendering an update is leaving behind for no value at all', () => {
		expect(broadcastGraphicsRenderedInputGraphicAssetReferences(
			[graphic([mediaInput('backdrop')])],
			{
				current: { 'lower-third': { backdrop: null } },
				outgoing: { 'lower-third': { backdrop: sponsor } },
			},
		)).toEqual([{
			reference: { assetId: 'image-asset', revisionId: 'image-revision-1' },
			ownerSlot: 'liveSession.lower-third.inputs.backdrop.outgoing',
			kind: 'image',
		}]);
	});

	it('finds nothing for a value whose Graphic Input is no longer declared', () => {
		// A declaration removed by a later authored write leaves its value behind, and a
		// Screen publishes what it declares — the same rule the accepted walk follows.
		expect(broadcastGraphicsRenderedInputGraphicAssetReferences(
			[graphic([])],
			{ current: { 'lower-third': { backdrop: sponsor } } },
		)).toEqual([]);
	});

	it('finds nothing for a non-media Graphic Input, whatever its value looks like', () => {
		expect(broadcastGraphicsRenderedInputGraphicAssetReferences(
			[graphic([{ type: 'text', key: 'name', label: 'Name', required: false, updatePolicy: 'staged', default: '', maxLength: 40 }])],
			{ current: { 'lower-third': { name: sponsor as unknown as string } } },
		)).toEqual([]);
	});

	/**
	 * The declared kind is not a guarantee about the stored value. A value that
	 * violates its declaration is stored rather than coerced — that is what lets Live
	 * Control show an operator exactly what is there and why it cannot go on air — so a
	 * media Graphic Input can be holding a string an earlier declaration left behind.
	 * Reading it as a reference would build one out of `undefined` ids.
	 */
	it('finds nothing for a media Graphic Input holding something that is not a media value', () => {
		expect(broadcastGraphicsRenderedInputGraphicAssetReferences(
			[graphic([mediaInput('backdrop')])],
			{ current: { 'lower-third': { backdrop: 'a value an earlier declaration left behind' } } },
		)).toEqual([]);
	});

	it('finds nothing for a Broadcast Graphic the rendering has no entry for', () => {
		expect(broadcastGraphicsRenderedInputGraphicAssetReferences(
			[graphic([mediaInput('backdrop')])],
			{ current: {} },
		)).toEqual([]);
	});

	it('finds every graphic’s media, not only the first that has some', () => {
		const second: Pick<BroadcastGraphicConfig, 'id' | 'inputs'> = {
			id: 'slate',
			inputs: [mediaInput('logo')],
		};

		expect(broadcastGraphicsRenderedInputGraphicAssetReferences(
			[graphic([mediaInput('backdrop')]), second],
			{ current: { 'lower-third': {}, 'slate': { logo: sponsor } } },
		).map(reference => reference.ownerSlot)).toEqual(['liveSession.slate.inputs.logo']);
	});
});
