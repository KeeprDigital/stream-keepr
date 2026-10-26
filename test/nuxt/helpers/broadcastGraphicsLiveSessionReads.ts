import type {
	BroadcastGraphicChannelContext,
	BroadcastGraphicsLiveState,
} from '~~/shared/modules/broadcast-graphics-live-session';
import type {
	BroadcastGraphicConfig,
	GraphicChannelConfig,
	GraphicInputValue,
	SocialProfileProjectionValues,
} from '~~/shared/types/graphics';
import {
	broadcastGraphicChannelContexts,
	broadcastGraphicInputsState,
	broadcastGraphicPhaseProjections,
	broadcastGraphicPhaseTiming,
	broadcastGraphicPlayoutState,
	broadcastGraphicRenderedInputs,
	broadcastGraphicRenderedSocialProfilePresentations,
	broadcastGraphicRenderedSocialProfileValues,
	broadcastGraphicSourceSelections,
	graphicInputTraces,
	onAirBroadcastGraphicIds,
	socialProfilePresentationProjections,
	socialProfileProjectionValues,
} from '~~/shared/modules/broadcast-graphics-live-session';

type Timed = Pick<BroadcastGraphicConfig, 'items' | 'animation'>;

/** Keeps the graphics whose answer is non-empty, as the store does. */
function nonEmpty<T extends object>(graphics: readonly { id: string }[], read: (graphic: any) => T) {
	return Object.fromEntries(graphics.flatMap((graphic) => {
		const value = read(graphic);
		return Object.keys(value).length > 0
			? [
					[graphic.id, value],
				]
			: [];
	}));
}

/**
 * `useBroadcastGraphicsLiveSessionStore`'s read selectors over a Live State and
 * clock the test controls, computed through the same shared functions the store
 * uses, with the clock always synchronised. Spread it into a store mock beside the
 * actions a suite records:
 * `mockNuxtImport('useBroadcastGraphicsLiveSessionStore', () => () => ({ ...liveSessionSelectors(() => state.value, () => now.value), take }))`.
 */
export function liveSessionSelectors(state: () => BroadcastGraphicsLiveState, serverNow: () => number) {
	const timing = (graphic: Timed, now?: number, channel?: BroadcastGraphicChannelContext) =>
		broadcastGraphicPhaseTiming(graphic, now ?? serverNow(), channel);

	function channelContexts(graphics: readonly BroadcastGraphicConfig[], channels: readonly GraphicChannelConfig[] | undefined) {
		return channels?.length
			? broadcastGraphicChannelContexts({ graphics, channels })
			: {};
	}

	function playoutState(_screenId: number, graphicId: string, graphic?: Timed, now?: number, channel?: BroadcastGraphicChannelContext) {
		return broadcastGraphicPlayoutState(state(), graphicId, graphic
			? timing(graphic, now, channel)
			: undefined);
	}

	function rendered<T>(graphics: readonly BroadcastGraphicConfig[], now: number | undefined, read: (graphic: BroadcastGraphicConfig, instant: number) => { current: T; outgoing?: T }) {
		const current: Record<string, T> = {};
		const outgoing: Record<string, T> = {};
		for (const graphic of graphics) {
			const values = read(graphic, now ?? serverNow());
			current[graphic.id] = values.current;
			if (values.outgoing)
				outgoing[graphic.id] = values.outgoing;
		}
		return { current, outgoing };
	}

	return {
		serverNow,
		channelContexts,
		playoutState,
		onAirGraphicIds: (_screenId: number, graphics: readonly BroadcastGraphicConfig[], now?: number, channels?: readonly GraphicChannelConfig[]) => {
			const contexts = channelContexts(graphics, channels);
			return onAirBroadcastGraphicIds(state(), graphics, graphic => timing(graphic as BroadcastGraphicConfig, now, contexts[graphic.id]));
		},
		animationProjection: (_screenId: number, graphics: readonly BroadcastGraphicConfig[], now?: number, channels?: readonly GraphicChannelConfig[]) => {
			const contexts = channelContexts(graphics, channels);
			return Object.fromEntries(graphics.flatMap((graphic) => {
				const projected = broadcastGraphicPhaseProjections(state(), graphic.id, timing(graphic, now, contexts[graphic.id]));
				return projected.length > 0
					? [
							[graphic.id, projected],
						]
					: [];
			}));
		},
		renderedInputValues: (_screenId: number, graphics: readonly BroadcastGraphicConfig[], now?: number) =>
			rendered<Record<string, GraphicInputValue>>(graphics, now, (graphic, instant) =>
				broadcastGraphicRenderedInputs(state(), graphic.id, graphic.inputs ?? [], timing(graphic, instant))),
		renderedSocialProfileValues: (_screenId: number, graphics: readonly BroadcastGraphicConfig[], now?: number) =>
			rendered<SocialProfileProjectionValues>(graphics, now, (graphic, instant) =>
				broadcastGraphicRenderedSocialProfileValues(state(), graphic, timing(graphic, instant))),
		renderedSocialProfilePresentations: (_screenId: number, graphics: readonly BroadcastGraphicConfig[], now?: number) =>
			rendered(graphics, now, (graphic, instant) =>
				broadcastGraphicRenderedSocialProfilePresentations(state(), graphic, timing(graphic, instant))),
		socialProfileValues: (_screenId: number, graphics: readonly BroadcastGraphicConfig[], now?: number) =>
			nonEmpty(graphics, graphic => socialProfileProjectionValues(state(), graphic, now ?? serverNow())),
		socialProfilePresentations: (_screenId: number, graphics: readonly BroadcastGraphicConfig[], now?: number) =>
			nonEmpty(graphics, graphic => socialProfilePresentationProjections(state(), graphic, now ?? serverNow())),
		inputsState: (_screenId: number, graphicId: string) => broadcastGraphicInputsState(state(), graphicId),
		sourceSelections: (_screenId: number, graphicId: string) => broadcastGraphicSourceSelections(state(), graphicId),
		inputTraces: (screenId: number, graphic: BroadcastGraphicConfig, boundValues: Readonly<Record<string, GraphicInputValue>> = {}) => {
			const playout = playoutState(screenId, graphic.id);
			return graphicInputTraces(state(), graphic.id, graphic, boundValues, {
				onAir: playout !== 'off' && playout !== 'waiting',
				supersededInputKeys: [],
			});
		},
	};
}
