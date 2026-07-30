import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { GraphicsSelectionTarget } from './selection';
import { isGraphicsSelectionTarget } from './selection';

/**
 * The messages the graphics compositor's editor surface and its embedded
 * preview exchange. The preview is a real Screen Output frame, so the editor
 * pushes the working composition into it and the frame reports selections back.
 *
 * Both guards demand the expected origin and window, so a frame the editor did
 * not embed — and any cross-origin sender — is ignored.
 */

export const GRAPHICS_PREVIEW_STATE_MESSAGE = 'graphics-compositor:preview-state';
export const GRAPHICS_PREVIEW_SELECT_MESSAGE = 'graphics-compositor:select';

export interface GraphicsPreviewState {
	/** The working stack of Broadcast Graphics, unsaved edits included. */
	graphics: BroadcastGraphicConfig[];
	/** The Broadcast Graphic the editor is composing, shown in place of the on-air set. */
	previewGraphicId: string | null;
	selectedTarget: GraphicsSelectionTarget;
}

interface MessageEnvelope {
	origin: string;
	source: unknown;
	data: unknown;
}

interface ExpectedSender {
	origin: string;
	source: unknown;
}

function isFromExpectedSender(message: MessageEnvelope, expected: ExpectedSender): boolean {
	return message.origin === expected.origin
		&& message.source === expected.source
		&& expected.source !== null
		&& expected.source !== undefined
		&& typeof message.data === 'object'
		&& message.data !== null;
}

export function isGraphicsPreviewStateMessage(
	message: MessageEnvelope,
	expected: ExpectedSender,
): message is MessageEnvelope & { data: { type: string; state: GraphicsPreviewState } } {
	if (!isFromExpectedSender(message, expected))
		return false;

	const data = message.data as Record<string, unknown>;
	if (data.type !== GRAPHICS_PREVIEW_STATE_MESSAGE)
		return false;

	const state = data.state as Record<string, unknown> | undefined;
	return typeof state === 'object'
		&& state !== null
		&& Array.isArray(state.graphics)
		&& (state.previewGraphicId === null || typeof state.previewGraphicId === 'string')
		&& isGraphicsSelectionTarget(state.selectedTarget);
}

export function isGraphicsPreviewSelectMessage(
	message: MessageEnvelope,
	expected: ExpectedSender,
): message is MessageEnvelope & { data: { type: string; target: GraphicsSelectionTarget } } {
	if (!isFromExpectedSender(message, expected))
		return false;

	const data = message.data as Record<string, unknown>;
	return data.type === GRAPHICS_PREVIEW_SELECT_MESSAGE && isGraphicsSelectionTarget(data.target);
}
