import type { ComputedRef } from 'vue';
import type { EventKind } from '~~/shared/config/games';
import { eventKind } from '~~/shared/config/games';

/** The kind of Event the operator's Event is, by its Card Game and Variant; none before it loads. */
export function useEventKind(): ComputedRef<EventKind | undefined> {
	const eventStore = useEventStore();
	return computed(() => eventStore.event
		? eventKind(eventStore.event)
		: undefined);
}
