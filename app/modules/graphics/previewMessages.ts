import type { BroadcastGraphicConfig, GraphicAnimationPhase, SocialProfileProjectionValues } from '~~/shared/types/graphics';
import type { GraphicsSelectionTarget } from './selection';
import { canonicalSocialProfileUrl, SUPPORTED_SOCIAL_NETWORK_BY_KEY } from '~~/shared/socialProfiles';
import { GRAPHIC_ANIMATION_PHASE_VALUES } from '~~/shared/types/graphics';
import { isGraphicsSelectionTarget } from './selection';

/**
 * The messages the graphics compositor's editor surface and its embedded
 * preview exchange. The preview is a real Screen Output frame, so the editor
 * pushes the working composition into it and the frame reports selections back.
 *
 * Every guard here demands the expected origin and window, so a frame the editor
 * did not embed — and any cross-origin sender — is ignored. That check is
 * `isFromExpectedSender`, exported so the hosts with their own preview messages
 * share it rather than reimplementing it.
 */

export const GRAPHICS_PREVIEW_STATE_MESSAGE = 'graphics-compositor:preview-state';
export const GRAPHICS_PREVIEW_SELECT_MESSAGE = 'graphics-compositor:select';

/**
 * The frame announcing that it is listening.
 *
 * The editor's other channel to the frame is the iframe's own `load` event, and
 * that is not the moment the frame can be spoken to: this application renders on
 * the client, so `load` fires when the shell and its scripts have arrived, while
 * the frame's `message` listener is installed when its app mounts — afterwards,
 * and by an amount nothing here controls. A push that loses that race is dropped
 * in silence, and the frame then holds the Screen's *stored* stack rather than
 * the working one, which looks like a preview that renders the wrong thing
 * rather than one that missed a message (#234).
 *
 * So the frame speaks first. The editor answers a ready with a full push, which
 * makes the initial exchange a handshake rather than a race, and costs one
 * duplicate push in the case where `load` did win.
 */
export const GRAPHICS_PREVIEW_READY_MESSAGE = 'graphics-compositor:preview-ready';

/**
 * The compositor selection, pushed on its own rather than inside a whole preview
 * state.
 *
 * A host that owns its preview transport already pushes its own working
 * composition — a Feature Match Overlay pushes a whole mode configuration,
 * because its Frame and Source Items are host-owned and travel with it. Only the
 * shared compositor's selection is missing from that, and it is the same
 * `GraphicsSelectionTarget` whichever host sends it, so it travels as one shared
 * message rather than as a second per-host one.
 */
export const GRAPHICS_PREVIEW_SELECTED_TARGET_MESSAGE = 'graphics-compositor:selected-target';

/** How much of a lifecycle one Graphic Animation Preview run plays. */
export const GRAPHICS_PREVIEW_ANIMATION_SCOPE_VALUES = ['phase', 'lifecycle'] as const;

export type GraphicsPreviewAnimationScope = typeof GRAPHICS_PREVIEW_ANIMATION_SCOPE_VALUES[number];

/**
 * One Graphic Animation Preview run, as an instruction rather than a stream of
 * frames.
 *
 * The editor says *what* to play and the preview frame runs its own clock over the
 * working composition it already holds, which is the same relationship a live
 * Screen Output has with an authoritative effective start time. That is what makes
 * the preview deterministic: one elapsed time produces one frame, through exactly
 * the projection a live output uses, with no live state and no session involved.
 *
 * There is no playhead and no scrubbing: `run` is a token the editor changes to
 * start a run over, and playback is otherwise described entirely by its scope,
 * speed, and whether it loops.
 */
export interface GraphicsPreviewAnimationPlan {
	/** The Broadcast Graphic being previewed. Every other graphic stays at rest. */
	graphicId: string;
	scope: GraphicsPreviewAnimationScope;
	/** The single phase a `phase` run plays, and where a `lifecycle` run starts. */
	phase: GraphicAnimationPhase;
	/** Changing this restarts the run. It is not a time and carries no schedule. */
	run: number;
	/** Playback rate multiplier. */
	speed: number;
	/** Restart the run when it completes rather than holding its final phase. */
	loop: boolean;
}

export interface GraphicsPreviewState {
	/** The working stack of Broadcast Graphics, unsaved edits included. */
	graphics: BroadcastGraphicConfig[];
	/**
	 * What the editor has selected. The preview composes the whole authored
	 * stack — so reordering it is visible — and uses this only to mark which
	 * Broadcast Graphic and Graphic Item are under authoring.
	 */
	selectedTarget: GraphicsSelectionTarget;
	/**
	 * Non-persisted representative values for programmatically authored Social
	 * Profile Projections. The editor may replace these with its own sample controls.
	 */
	socialProfileValues?: Readonly<Record<string, SocialProfileProjectionValues>>;
	/**
	 * The current Graphic Animation Preview run, if the author has started one.
	 * Absent composes every Broadcast Graphic at its Graphic Resting State, which is
	 * what an author laying a composition out wants to see.
	 */
	animation?: GraphicsPreviewAnimationPlan | null;
}

/**
 * A preview plan, or null if this is not one.
 *
 * Validated field by field rather than trusted: it arrives over `postMessage`, and
 * the sender check above proves only where a message came from, not what is in it.
 * A malformed plan is dropped so the preview holds its Graphic Resting State
 * instead of running an unbounded or reversed clock.
 */
export function readGraphicsPreviewAnimationPlan(value: unknown): GraphicsPreviewAnimationPlan | null {
	if (typeof value !== 'object' || value === null)
		return null;

	const plan = value as Record<string, unknown>;
	if (typeof plan.graphicId !== 'string' || plan.graphicId.length === 0)
		return null;
	if (plan.scope !== 'phase' && plan.scope !== 'lifecycle')
		return null;
	if (!GRAPHIC_ANIMATION_PHASE_VALUES.includes(plan.phase as GraphicAnimationPhase))
		return null;
	if (typeof plan.run !== 'number' || !Number.isFinite(plan.run))
		return null;
	if (typeof plan.speed !== 'number' || !Number.isFinite(plan.speed) || plan.speed <= 0)
		return null;
	if (typeof plan.loop !== 'boolean')
		return null;

	return {
		graphicId: plan.graphicId,
		scope: plan.scope,
		phase: plan.phase as GraphicAnimationPhase,
		run: plan.run,
		speed: plan.speed,
		loop: plan.loop,
	};
}

export interface MessageEnvelope {
	origin: string;
	source: unknown;
	data: unknown;
}

export interface ExpectedSender {
	origin: string;
	source: unknown;
}

/**
 * Whether a `postMessage` arrival came from the one window this surface is
 * entitled to hear from, carrying something to read.
 *
 * Exported because it is the whole of the sender check for every preview
 * transport, not only the compositor's own: a Feature Match Overlay pushes a
 * host-owned configuration and two selections over the same channel, and those
 * guards are built from this rather than from copies of it (#252). Duplicated
 * security logic drifts, and the copy that drifts looser is the one nothing
 * notices.
 *
 * Demanding that `expected.source` exists is not redundant with comparing it.
 * A `MessageEvent` carries a null source unless a window sent it, and a preview
 * frame that is gone — or not yet embedded — leaves the expected source null or
 * undefined; comparing the two then matches, admitting a message from nobody at
 * exactly the moment there is nobody entitled to send one.
 */
export function isFromExpectedSender(message: MessageEnvelope, expected: ExpectedSender): boolean {
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
	if (typeof state !== 'object' || state === null)
		return false;
	if (!Array.isArray(state.graphics) || !isGraphicsSelectionTarget(state.selectedTarget))
		return false;

	return true;
}

/**
 * The preview state a validated message carries, with its run normalised.
 *
 * Separate from the guard above because a predicate that also rewrites its input is
 * a hidden contract: every caller then depends on a side effect its name does not
 * mention. The guard answers whether the message is one of ours; this answers what
 * it says.
 *
 * An absent or malformed run is not a malformed state message — the working
 * composition still has to reach the preview, holding its Graphic Resting State —
 * so it normalises to null rather than rejecting the whole push.
 */
export function readGraphicsPreviewState(state: GraphicsPreviewState): GraphicsPreviewState {
	const socialProfileValues = state.socialProfileValues ?? Object.fromEntries(
		state.graphics.flatMap(graphic => (graphic.socialProfileProjections ?? []).length === 0
			? []
			: [[graphic.id, Object.fromEntries(graphic.socialProfileProjections!.map(projection => [
					projection.key,
					{
						network: 'twitch' as const,
						networkLabel: SUPPORTED_SOCIAL_NETWORK_BY_KEY.twitch.label,
						handle: 'example',
						profileUrl: canonicalSocialProfileUrl('twitch', 'example'),
					},
				]))]]),
	);
	return {
		...state,
		...(Object.keys(socialProfileValues).length > 0 ? { socialProfileValues } : {}),
		animation: state.animation === undefined || state.animation === null
			? null
			: readGraphicsPreviewAnimationPlan(state.animation),
	};
}

/** The editor's current compositor selection, pushed into an embedded preview. */
export function isGraphicsPreviewSelectedTargetMessage(
	message: MessageEnvelope,
	expected: ExpectedSender,
): message is MessageEnvelope & { data: { type: string; target: GraphicsSelectionTarget } } {
	if (!isFromExpectedSender(message, expected))
		return false;

	const data = message.data as Record<string, unknown>;
	return data.type === GRAPHICS_PREVIEW_SELECTED_TARGET_MESSAGE && isGraphicsSelectionTarget(data.target);
}

/** An embedded preview reporting that its listeners are installed. */
export function isGraphicsPreviewReadyMessage(
	message: MessageEnvelope,
	expected: ExpectedSender,
): boolean {
	if (!isFromExpectedSender(message, expected))
		return false;

	return (message.data as Record<string, unknown>).type === GRAPHICS_PREVIEW_READY_MESSAGE;
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
