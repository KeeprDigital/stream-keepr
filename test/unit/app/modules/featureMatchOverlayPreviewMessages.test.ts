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

		it('ignores a pushed selection that names nothing this host owns', () => {
			// The push direction's own payload check, which nothing covered until the
			// review found it: without it, whatever the editor sent became the frame's
			// host-owned selection unexamined. Its sibling below has had this since the
			// module was written — the same check, one guard over.
			for (const target of [{ type: 'unsupported' }, { type: 'source' }, undefined, null]) {
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
	 * Each guard answers for its own message and no other.
	 *
	 * The sibling above proves it across vocabularies, and that turned out to be the
	 * easy half: the compositor's target is a shape this host cannot resolve, so the
	 * payload check rejects those messages whether or not the type is read at all.
	 * These three carry a payload the guard under test would otherwise accept, which
	 * leaves the type comparison as the only thing that can say no — and all three
	 * comparisons survived being replaced with `true` until this existed.
	 *
	 * What it protects is a real confusion, not a hypothetical one: the push and the
	 * report travel in opposite directions over one channel between the same two
	 * windows, carrying the identical target shape. A frame that read the wrong one
	 * would treat its own outgoing selection as an instruction from the editor.
	 */
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

	/**
	 * The wire itself, pinned as literals rather than through the constants.
	 *
	 * The whole point of naming these once is that both ends move together, so a
	 * test written in the constants cannot tell a rename from a no-op — and a
	 * rename here is a wire break: a preview frame served by a deployment one
	 * version behind stops hearing the editor entirely, in silence. The component
	 * suites dispatch and assert these same literals for the same reason (#260).
	 *
	 * That is an argument about an individual test, not about the arrangement. This
	 * pin alone would catch a rename, so the literals in the component suites are
	 * defence in depth rather than the only safe arrangement — they are what makes a
	 * rename fail at both ends at once, which is what proves the two ends share a
	 * vocabulary rather than each holding its own copy. The compositor's own module
	 * has no pin of this kind at all, so this is an improvement on that precedent
	 * rather than a copy of it.
	 */
	it('spells each message the way it goes on the wire', () => {
		expect(FEATURE_MATCH_OVERLAY_PREVIEW_CONFIG_MESSAGE).toBe('feature-match-overlay:preview-config');
		expect(FEATURE_MATCH_OVERLAY_PREVIEW_SELECTED_TARGET_MESSAGE).toBe('feature-match-overlay:selected-target');
		expect(FEATURE_MATCH_OVERLAY_PREVIEW_SELECT_MESSAGE).toBe('feature-match-overlay:select');
	});
});
