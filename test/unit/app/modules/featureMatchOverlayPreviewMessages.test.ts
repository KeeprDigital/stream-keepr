import { describe, expect, it } from 'vitest';
import {
	FEATURE_MATCH_OVERLAY_PREVIEW_CONFIG_MESSAGE,
	FEATURE_MATCH_OVERLAY_PREVIEW_SELECT_MESSAGE,
	FEATURE_MATCH_OVERLAY_PREVIEW_SELECTED_TARGET_MESSAGE,
	isFeatureMatchOverlayPreviewConfigMessage,
	isFeatureMatchOverlayPreviewSelectedTargetMessage,
	isFeatureMatchOverlayPreviewSelectMessage,
} from '~/modules/feature-match-overlay/previewMessages';
import {
	GRAPHICS_PREVIEW_SELECT_MESSAGE,
	GRAPHICS_PREVIEW_SELECTED_TARGET_MESSAGE,
} from '~/modules/graphics/previewMessages';

const editorWindow = { name: 'editor' };
const previewWindow = { name: 'preview' };
const expectedFromEditor = { origin: 'https://keepr.test', source: editorWindow };
const expectedFromPreview = { origin: 'https://keepr.test', source: previewWindow };

const config = {
	layout: { sources: [] },
};
const sourceTarget = { type: 'source', itemId: 'main-source' };

describe('featureMatchOverlayPreviewMessages', () => {
	describe('the working Feature Match Layout the editor pushes in', () => {
		it('accepts a push from the editor that embedded the preview', () => {
			expect(isFeatureMatchOverlayPreviewConfigMessage({
				origin: 'https://keepr.test',
				source: editorWindow,
				data: { type: FEATURE_MATCH_OVERLAY_PREVIEW_CONFIG_MESSAGE, config },
			}, expectedFromEditor)).toBe(true);
		});

		it('ignores a push from another origin or another window', () => {
			expect(isFeatureMatchOverlayPreviewConfigMessage({
				origin: 'https://attacker.test',
				source: editorWindow,
				data: { type: FEATURE_MATCH_OVERLAY_PREVIEW_CONFIG_MESSAGE, config },
			}, expectedFromEditor)).toBe(false);

			expect(isFeatureMatchOverlayPreviewConfigMessage({
				origin: 'https://keepr.test',
				source: previewWindow,
				data: { type: FEATURE_MATCH_OVERLAY_PREVIEW_CONFIG_MESSAGE, config },
			}, expectedFromEditor)).toBe(false);
		});

		it('ignores a push carrying no configuration at all', () => {
			// A push with nothing in it would otherwise replace the stored layout with
			// null and leave the preview rendering an empty Screen, which reads as a
			// broken layout rather than as a dropped message.
			for (const absent of [null, undefined, 'a layout']) {
				expect(isFeatureMatchOverlayPreviewConfigMessage({
					origin: 'https://keepr.test',
					source: editorWindow,
					data: { type: FEATURE_MATCH_OVERLAY_PREVIEW_CONFIG_MESSAGE, config: absent },
				}, expectedFromEditor)).toBe(false);
			}
		});
	});

	describe('the two host-owned selections', () => {
		it('accepts the editor’s selection pushed into the frame', () => {
			expect(isFeatureMatchOverlayPreviewSelectedTargetMessage({
				origin: 'https://keepr.test',
				source: editorWindow,
				data: {
					type: FEATURE_MATCH_OVERLAY_PREVIEW_SELECTED_TARGET_MESSAGE,
					target: { type: 'canvas' },
				},
			}, expectedFromEditor)).toBe(true);
		});

		it('ignores a selection pushed by anyone but the embedding editor', () => {
			for (const message of [
				{ origin: 'https://attacker.test', source: editorWindow },
				{ origin: 'https://keepr.test', source: previewWindow },
			]) {
				expect(isFeatureMatchOverlayPreviewSelectedTargetMessage({
					...message,
					data: { type: FEATURE_MATCH_OVERLAY_PREVIEW_SELECTED_TARGET_MESSAGE, target: sourceTarget },
				}, expectedFromEditor)).toBe(false);
			}
		});

		it('ignores a pushed selection that names nothing this host owns', () => {
			for (const target of [
				{ type: 'unsupported' },
				{ type: 'source' },
				undefined,
				null,
			]) {
				expect(isFeatureMatchOverlayPreviewSelectedTargetMessage({
					origin: 'https://keepr.test',
					source: editorWindow,
					data: { type: FEATURE_MATCH_OVERLAY_PREVIEW_SELECTED_TARGET_MESSAGE, target },
				}, expectedFromEditor)).toBe(false);
			}
		});

		it('accepts the frame’s selection reported back, and only from that frame', () => {
			const message = {
				origin: 'https://keepr.test',
				source: previewWindow,
				data: { type: FEATURE_MATCH_OVERLAY_PREVIEW_SELECT_MESSAGE, target: sourceTarget },
			};

			expect(isFeatureMatchOverlayPreviewSelectMessage(message, expectedFromPreview)).toBe(true);
			expect(isFeatureMatchOverlayPreviewSelectMessage(message, expectedFromEditor)).toBe(false);
		});

		it('ignores a selection that names nothing this host owns', () => {
			for (const target of [
				{ type: 'unsupported' },
				{ type: 'source' },
				null,
			]) {
				expect(isFeatureMatchOverlayPreviewSelectMessage({
					origin: 'https://keepr.test',
					source: previewWindow,
					data: { type: FEATURE_MATCH_OVERLAY_PREVIEW_SELECT_MESSAGE, target },
				}, expectedFromPreview)).toBe(false);
			}
		});

		it('ignores a selection sent before the frame exists', () => {
			// A `MessageEvent` carries a null source unless a window sent it, so a frame
			// that is gone leaves both sides null — and comparing them alone would match.
			expect(isFeatureMatchOverlayPreviewSelectMessage({
				origin: 'https://keepr.test',
				source: null,
				data: { type: FEATURE_MATCH_OVERLAY_PREVIEW_SELECT_MESSAGE, target: sourceTarget },
			}, { origin: 'https://keepr.test', source: null })).toBe(false);
		});
	});

	// Both vocabularies share one channel, and every listener sees every message.
	it('never reads the shared compositor’s messages as host-owned ones', () => {
		const compositorTarget = { type: 'item', graphicId: 'feature-match-layout', itemId: 'shared-clock' };

		expect(isFeatureMatchOverlayPreviewSelectMessage({
			origin: 'https://keepr.test',
			source: previewWindow,
			data: { type: GRAPHICS_PREVIEW_SELECT_MESSAGE, target: compositorTarget },
		}, expectedFromPreview)).toBe(false);

		expect(isFeatureMatchOverlayPreviewSelectedTargetMessage({
			origin: 'https://keepr.test',
			source: editorWindow,
			data: { type: GRAPHICS_PREVIEW_SELECTED_TARGET_MESSAGE, target: compositorTarget },
		}, expectedFromEditor)).toBe(false);
	});

	// The push and the report carry the identical target shape over one channel, so
	// only the type comparison stops a frame reading its own report as an instruction.
	it('answers for its own message type and no other host-owned one', () => {
		const alien = [
			FEATURE_MATCH_OVERLAY_PREVIEW_CONFIG_MESSAGE,
			FEATURE_MATCH_OVERLAY_PREVIEW_SELECTED_TARGET_MESSAGE,
			FEATURE_MATCH_OVERLAY_PREVIEW_SELECT_MESSAGE,
		];

		for (const type of alien.filter(candidate => candidate !== FEATURE_MATCH_OVERLAY_PREVIEW_CONFIG_MESSAGE)) {
			expect(isFeatureMatchOverlayPreviewConfigMessage({
				origin: 'https://keepr.test',
				source: editorWindow,
				data: { type, config },
			}, expectedFromEditor)).toBe(false);
		}

		for (const type of alien.filter(candidate => candidate !== FEATURE_MATCH_OVERLAY_PREVIEW_SELECTED_TARGET_MESSAGE)) {
			expect(isFeatureMatchOverlayPreviewSelectedTargetMessage({
				origin: 'https://keepr.test',
				source: editorWindow,
				data: { type, target: sourceTarget },
			}, expectedFromEditor)).toBe(false);
		}

		for (const type of alien.filter(candidate => candidate !== FEATURE_MATCH_OVERLAY_PREVIEW_SELECT_MESSAGE)) {
			expect(isFeatureMatchOverlayPreviewSelectMessage({
				origin: 'https://keepr.test',
				source: previewWindow,
				data: { type, target: sourceTarget },
			}, expectedFromPreview)).toBe(false);
		}
	});
});
