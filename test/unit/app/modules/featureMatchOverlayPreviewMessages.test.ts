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

const config = { layout: { sources: [] } };
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
				data: { type: FEATURE_MATCH_OVERLAY_PREVIEW_SELECTED_TARGET_MESSAGE, target: { type: 'canvas' } },
			}, expectedFromEditor)).toBe(true);
		});

		it('ignores a selection pushed by anyone but the embedding editor', () => {
			// The push carries what the frame will mark as under authoring, and this
			// guard is the only thing between that and any same-origin script on the
			// page. Its sibling below covers the same check on the way back; without
			// this, dropping the sender check here failed nothing in the module's own
			// suite and only one component test noticed.
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
			for (const target of [{ type: 'unsupported' }, { type: 'source' }, null]) {
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

	/**
	 * Both vocabularies travel over one channel between the same two windows, and
	 * every listener on that channel sees every message. A guard that read only its
	 * payload would take the compositor's selection — a different vocabulary, whose
	 * `{ type: 'item' }` target this host cannot resolve — as one of its own.
	 */
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

	/**
	 * The wire itself, pinned as literals rather than through the constants.
	 *
	 * The whole point of naming these once is that both ends move together, so a
	 * test written in the constants cannot tell a rename from a no-op — and a
	 * rename here is a wire break: a preview frame served by a deployment one
	 * version behind stops hearing the editor entirely, in silence. The component
	 * suites dispatch and assert these same literals for the same reason (#260).
	 */
	it('spells each message the way it goes on the wire', () => {
		expect(FEATURE_MATCH_OVERLAY_PREVIEW_CONFIG_MESSAGE).toBe('feature-match-overlay:preview-config');
		expect(FEATURE_MATCH_OVERLAY_PREVIEW_SELECTED_TARGET_MESSAGE).toBe('feature-match-overlay:selected-target');
		expect(FEATURE_MATCH_OVERLAY_PREVIEW_SELECT_MESSAGE).toBe('feature-match-overlay:select');
	});
});
