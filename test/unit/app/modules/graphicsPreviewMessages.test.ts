import { describe, expect, it } from 'vitest';
import {
	GRAPHICS_PREVIEW_SELECT_MESSAGE,
	GRAPHICS_PREVIEW_STATE_MESSAGE,
	isGraphicsPreviewSelectMessage,
	isGraphicsPreviewStateMessage,
} from '~/modules/graphics/previewMessages';

const editorWindow = { name: 'editor' };
const previewWindow = { name: 'preview' };
const expectedFromPreview = { origin: 'https://keepr.test', source: previewWindow };
const expectedFromEditor = { origin: 'https://keepr.test', source: editorWindow };

const state = {
	graphics: [{ id: 'lower-third', name: 'Lower Third', items: [] }],
	previewGraphicId: 'lower-third',
	selectedTarget: { type: 'canvas' },
};

describe('graphicsPreviewMessages', () => {
	it('accepts working composition state from the editor that embedded the preview', () => {
		expect(isGraphicsPreviewStateMessage({
			origin: 'https://keepr.test',
			source: editorWindow,
			data: { type: GRAPHICS_PREVIEW_STATE_MESSAGE, state },
		}, expectedFromEditor)).toBe(true);
	});

	it('ignores composition state from another origin or another window', () => {
		expect(isGraphicsPreviewStateMessage({
			origin: 'https://attacker.test',
			source: editorWindow,
			data: { type: GRAPHICS_PREVIEW_STATE_MESSAGE, state },
		}, expectedFromEditor)).toBe(false);

		expect(isGraphicsPreviewStateMessage({
			origin: 'https://keepr.test',
			source: previewWindow,
			data: { type: GRAPHICS_PREVIEW_STATE_MESSAGE, state },
		}, expectedFromEditor)).toBe(false);
	});

	it('ignores composition state that is not shaped like a working composition', () => {
		expect(isGraphicsPreviewStateMessage({
			origin: 'https://keepr.test',
			source: editorWindow,
			data: { type: GRAPHICS_PREVIEW_STATE_MESSAGE, state: { graphics: 'all', previewGraphicId: 1 } },
		}, expectedFromEditor)).toBe(false);
	});

	it('accepts a selection only from the preview frame the editor embedded', () => {
		const message = {
			origin: 'https://keepr.test',
			source: previewWindow,
			data: { type: GRAPHICS_PREVIEW_SELECT_MESSAGE, target: { type: 'item', graphicId: 'a', itemId: 'b' } },
		};

		expect(isGraphicsPreviewSelectMessage(message, expectedFromPreview)).toBe(true);
		expect(isGraphicsPreviewSelectMessage(message, expectedFromEditor)).toBe(false);
	});

	it('ignores a selection that is not a graphics selection target', () => {
		expect(isGraphicsPreviewSelectMessage({
			origin: 'https://keepr.test',
			source: previewWindow,
			data: { type: GRAPHICS_PREVIEW_SELECT_MESSAGE, target: { type: 'item', graphicId: 'a' } },
		}, expectedFromPreview)).toBe(false);
	});

	it('ignores messages before the preview frame exists', () => {
		expect(isGraphicsPreviewSelectMessage({
			origin: 'https://keepr.test',
			source: null,
			data: { type: GRAPHICS_PREVIEW_SELECT_MESSAGE, target: { type: 'canvas' } },
		}, { origin: 'https://keepr.test', source: null })).toBe(false);
	});
});
