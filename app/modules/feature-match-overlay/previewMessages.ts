import type { FeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import type { FeatureMatchOverlaySelectionTarget } from './selection';
import type { ExpectedSender, MessageEnvelope } from '~/modules/graphics/previewMessages';
import { isFromExpectedSender } from '~/modules/graphics/previewMessages';
import { isFeatureMatchOverlaySelectionTarget } from './selection';

/**
 * The messages a Feature Match Overlay's editor surface and its embedded preview
 * exchange. The preview is a real Screen Output frame, so the editor pushes the
 * working Feature Match Layout into it and the frame reports selections back.
 *
 * These live here rather than beside the compositor's own messages because they
 * are host-owned: a Feature Match Layout and its Source Items mean nothing to a
 * Broadcast Graphics Screen, and the shared compositor should not carry a
 * vocabulary only one of its hosts speaks. What is shared is the sender check —
 * `isFromExpectedSender`, which #252 exported precisely so the hosts with their
 * own preview transports build their guards from it rather than from copies of
 * it. The one thing that must not drift is the one thing not duplicated.
 *
 * The constants exist for the same reason the compositor's do: a message type
 * spelled by hand at both ends is a message that silently never arrives when one
 * end is mistyped — no type error, no failing test unless a test happens to
 * cover that exact pair. Naming it once makes a rename a compile-time event
 * (#260).
 */

/**
 * The editor's working Feature Match Layout, pushed into the frame.
 *
 * Whole rather than incremental: the frame renders what it is handed, and an
 * editor that pushed edits would leave the two to diverge over a dropped
 * message.
 */
export const FEATURE_MATCH_OVERLAY_PREVIEW_CONFIG_MESSAGE = 'feature-match-overlay:preview-config';

/**
 * The editor's current host-owned selection — the Frame, or one Source Item —
 * pushed into the frame so it can mark what is under authoring.
 *
 * It travels beside the compositor's own selection rather than inside this
 * host's configuration push, because the two name things in different
 * vocabularies and at most one of them is ever non-canvas.
 */
export const FEATURE_MATCH_OVERLAY_PREVIEW_SELECTED_TARGET_MESSAGE = 'feature-match-overlay:selected-target';

/** A host-owned selection the frame reports back, made by clicking a guide. */
export const FEATURE_MATCH_OVERLAY_PREVIEW_SELECT_MESSAGE = 'feature-match-overlay:select';

/**
 * The working Feature Match Layout a validated push carries.
 *
 * Shape-checked no further than "an object": the configuration is merged with
 * this mode's defaults by the consumer, and rejecting a push field by field here
 * would leave the preview silently rendering the *stored* layout — the exact
 * failure #235 closed — whenever the two ends disagreed about an optional key.
 * The sender check above is what makes the payload trustworthy; this is what
 * makes it present.
 */
export function isFeatureMatchOverlayPreviewConfigMessage(
	message: MessageEnvelope,
	expected: ExpectedSender,
): message is MessageEnvelope & { data: { type: string; config: FeatureMatchOverlayModeConfig } } {
	if (!isFromExpectedSender(message, expected))
		return false;

	const data = message.data as Record<string, unknown>;
	return data.type === FEATURE_MATCH_OVERLAY_PREVIEW_CONFIG_MESSAGE
		&& typeof data.config === 'object'
		&& data.config !== null;
}

/** The editor's current host-owned selection, pushed into an embedded preview. */
export function isFeatureMatchOverlayPreviewSelectedTargetMessage(
	message: MessageEnvelope,
	expected: ExpectedSender,
): message is MessageEnvelope & { data: { type: string; target: FeatureMatchOverlaySelectionTarget } } {
	if (!isFromExpectedSender(message, expected))
		return false;

	const data = message.data as Record<string, unknown>;
	return data.type === FEATURE_MATCH_OVERLAY_PREVIEW_SELECTED_TARGET_MESSAGE
		&& isFeatureMatchOverlaySelectionTarget(data.target);
}

/** An embedded preview reporting the host-owned selection an author just made. */
export function isFeatureMatchOverlayPreviewSelectMessage(
	message: MessageEnvelope,
	expected: ExpectedSender,
): message is MessageEnvelope & { data: { type: string; target: FeatureMatchOverlaySelectionTarget } } {
	if (!isFromExpectedSender(message, expected))
		return false;

	const data = message.data as Record<string, unknown>;
	return data.type === FEATURE_MATCH_OVERLAY_PREVIEW_SELECT_MESSAGE
		&& isFeatureMatchOverlaySelectionTarget(data.target);
}
