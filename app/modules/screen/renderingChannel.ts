import type { ScreenContext } from '~/composables/screen/useScreenContext';
import { eventRealtimeChannel, screenRealtimeChannel } from '~~/shared/utils/realtimeChannels';

/**
 * Which realtime channel a rendering of a Screen hears changes on.
 *
 * A live rendering of a saved Screen, a Screen Output or a Program monitor,
 * hears only its Screen's own channel: the server tells that channel exactly
 * what the Screen shows, derived from its saved mode and configuration.
 *
 * A surface showing authored state hears its Event's channel instead: an
 * editor preview renders configuration not yet saved, which the server cannot
 * derive anything from, and a settings editor or Live Control is an operator
 * page already in its Event's room.
 */

/**
 * What a Screen Output's presence entry reports as `protocol`: it follows its
 * Screen's own channel and hears nothing from its Event's. An entry reporting
 * less, or nothing, is an output that still depends on the Event channel.
 */
export const SCREEN_CHANNEL_PROTOCOL = 2;

/**
 * The Event channel, for a surface showing authored state. The one seam
 * through which rendering code reaches it (`eslint.config.mjs` forbids the
 * direct import), so no Screen Output comes to depend on it unnoticed.
 */
export function authoringEventChannel(eventId: number): string {
	return eventRealtimeChannel(eventId);
}

/** The channel a rendering set up against `context` hears on, or `null` while it hears none. */
export function renderingChannel(context: Pick<ScreenContext, 'eventId' | 'screen' | 'followsScreenChannel' | 'sampleDataset'>): string | null {
	const eventId = context.eventId.value;
	// A Theme preview's sample belongs to no Event.
	if (context.sampleDataset || !eventId)
		return null;
	if (!context.followsScreenChannel?.value)
		return authoringEventChannel(eventId);
	const screen = context.screen.value;
	return screen
		? screenRealtimeChannel(eventId, screen.id)
		: null;
}
