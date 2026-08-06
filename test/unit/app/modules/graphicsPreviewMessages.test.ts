import { describe, expect, it } from 'vitest';
import {
	GRAPHICS_PREVIEW_READY_MESSAGE,
	GRAPHICS_PREVIEW_SELECT_MESSAGE,
	GRAPHICS_PREVIEW_STATE_MESSAGE,
	isFromExpectedSender,
	isGraphicsPreviewReadyMessage,
	isGraphicsPreviewSelectMessage,
	isGraphicsPreviewStateMessage,
	readGraphicsPreviewAnimationPlan,
	readGraphicsPreviewState,
} from '~/modules/graphics/previewMessages';

const editorWindow = { name: 'editor' };
const previewWindow = { name: 'preview' };
const expectedFromPreview = { origin: 'https://keepr.test', source: previewWindow };
const expectedFromEditor = { origin: 'https://keepr.test', source: editorWindow };

const state = {
	graphics: [{ id: 'lower-third', name: 'Lower Third', items: [] }],
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
			data: { type: GRAPHICS_PREVIEW_STATE_MESSAGE, state: { graphics: 'all', selectedTarget: { type: 'nowhere' } } },
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

/**
 * The sender check itself, exercised directly because it is the one piece every
 * guard on this channel shares — the compositor's own messages and the
 * host-owned ones a Feature Match Overlay exchanges with its preview alike
 * (#252). A copy of it that drifted looser would not announce itself, so what it
 * accepts is pinned here rather than only through its callers.
 */
describe('isFromExpectedSender', () => {
	const data = { type: 'anything' };

	it('accepts the expected window speaking from the expected origin', () => {
		expect(isFromExpectedSender(
			{ origin: 'https://keepr.test', source: editorWindow, data },
			expectedFromEditor,
		)).toBe(true);
	});

	it('rejects another window, and the expected one speaking from elsewhere', () => {
		expect(isFromExpectedSender(
			{ origin: 'https://keepr.test', source: previewWindow, data },
			expectedFromEditor,
		)).toBe(false);
		expect(isFromExpectedSender(
			{ origin: 'https://attacker.test', source: editorWindow, data },
			expectedFromEditor,
		)).toBe(false);
	});

	/**
	 * The case a hand-rolled `message.source === expected` comparison gets wrong.
	 * A `MessageEvent` carries a null source unless a window sent it, and a frame
	 * that is gone — or not yet embedded — leaves the expected source null or
	 * undefined. Comparing the two then matches, and the check admits a message
	 * from nobody at precisely the moment there is nobody entitled to send one.
	 */
	it('rejects a message from nobody when there is no expected sender either', () => {
		for (const absent of [null, undefined]) {
			expect(isFromExpectedSender(
				{ origin: 'https://keepr.test', source: absent, data },
				{ origin: 'https://keepr.test', source: absent },
			)).toBe(false);
		}
	});

	it('rejects a payload that is not an object, whoever sent it', () => {
		for (const payload of [null, undefined, 'select', 7]) {
			expect(isFromExpectedSender(
				{ origin: 'https://keepr.test', source: editorWindow, data: payload },
				expectedFromEditor,
			)).toBe(false);
		}
	});
});

describe('readGraphicsPreviewAnimationPlan', () => {
	const plan = {
		graphicId: 'lower-third',
		scope: 'phase',
		phase: 'enter',
		run: 3,
		speed: 0.5,
		loop: true,
	};

	it('accepts a well-formed Graphic Animation Preview run', () => {
		expect(readGraphicsPreviewAnimationPlan(plan)).toEqual(plan);
	});

	it('drops a run that names no Broadcast Graphic', () => {
		expect(readGraphicsPreviewAnimationPlan({ ...plan, graphicId: '' })).toBeNull();
		expect(readGraphicsPreviewAnimationPlan({ ...plan, graphicId: 7 })).toBeNull();
	});

	it('drops a run outside the lifecycle vocabulary', () => {
		expect(readGraphicsPreviewAnimationPlan({ ...plan, phase: 'hover' })).toBeNull();
		expect(readGraphicsPreviewAnimationPlan({ ...plan, scope: 'everything' })).toBeNull();
	});

	it('drops a speed that would run backwards or not at all', () => {
		// A non-positive or non-finite speed makes elapsed time meaningless, and the
		// preview has to hold its Graphic Resting State rather than guess.
		expect(readGraphicsPreviewAnimationPlan({ ...plan, speed: 0 })).toBeNull();
		expect(readGraphicsPreviewAnimationPlan({ ...plan, speed: -1 })).toBeNull();
		expect(readGraphicsPreviewAnimationPlan({ ...plan, speed: Number.POSITIVE_INFINITY })).toBeNull();
		expect(readGraphicsPreviewAnimationPlan({ ...plan, speed: '2' })).toBeNull();
	});

	it('drops a malformed run token or loop flag', () => {
		expect(readGraphicsPreviewAnimationPlan({ ...plan, run: 'first' })).toBeNull();
		expect(readGraphicsPreviewAnimationPlan({ ...plan, run: Number.NaN })).toBeNull();
		expect(readGraphicsPreviewAnimationPlan({ ...plan, loop: 'yes' })).toBeNull();
	});

	it('carries no schedule of its own, so the preview cannot be told when to be', () => {
		// A run is an instruction, not a timestamp: anything else on it is dropped.
		expect(readGraphicsPreviewAnimationPlan({ ...plan, startedAt: 12345, elapsed: 900 })).toEqual(plan);
	});

	it('drops anything that is not a run at all', () => {
		expect(readGraphicsPreviewAnimationPlan(null)).toBeNull();
		expect(readGraphicsPreviewAnimationPlan('enter')).toBeNull();
		expect(readGraphicsPreviewAnimationPlan(undefined)).toBeNull();
	});

	it('still accepts a state message whose run is absent or malformed', () => {
		// The working composition has to reach the preview either way; a bad run just
		// means the preview holds its Graphic Resting State.
		for (const animation of [undefined, null, { scope: 'phase' }]) {
			const message = {
				origin: 'https://keepr.test',
				source: editorWindow,
				data: {
					type: GRAPHICS_PREVIEW_STATE_MESSAGE,
					state: { graphics: [], selectedTarget: { type: 'canvas' }, animation },
				},
			};

			expect(isGraphicsPreviewStateMessage(message, expectedFromEditor)).toBe(true);
			// The guard does not rewrite the message; the reader normalises it.
			expect(readGraphicsPreviewState(message.data.state as never).animation).toBeNull();
		}
	});

	it('normalises a valid run onto the state it validated', () => {
		const message = {
			origin: 'https://keepr.test',
			source: editorWindow,
			data: {
				type: GRAPHICS_PREVIEW_STATE_MESSAGE,
				state: { graphics: [], selectedTarget: { type: 'canvas' }, animation: { ...plan, startedAt: 5 } },
			},
		};

		expect(isGraphicsPreviewStateMessage(message, expectedFromEditor)).toBe(true);
		expect(readGraphicsPreviewState(message.data.state as never).animation).toEqual(plan);
	});

	it('recognises a ready only from the frame the editor embedded', () => {
		// The announcement is what the editor answers with a full push, so a window
		// the editor did not embed must not be able to provoke one.
		const ready = { type: GRAPHICS_PREVIEW_READY_MESSAGE };

		expect(isGraphicsPreviewReadyMessage(
			{ origin: 'https://keepr.test', source: previewWindow, data: ready },
			expectedFromPreview,
		)).toBe(true);
		expect(isGraphicsPreviewReadyMessage(
			{ origin: 'https://keepr.test', source: editorWindow, data: ready },
			expectedFromPreview,
		)).toBe(false);
		expect(isGraphicsPreviewReadyMessage(
			{ origin: 'https://elsewhere.test', source: previewWindow, data: ready },
			expectedFromPreview,
		)).toBe(false);
		expect(isGraphicsPreviewReadyMessage(
			{ origin: 'https://keepr.test', source: previewWindow, data: { type: GRAPHICS_PREVIEW_SELECT_MESSAGE } },
			expectedFromPreview,
		)).toBe(false);
	});
});
