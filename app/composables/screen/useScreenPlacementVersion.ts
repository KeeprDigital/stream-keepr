import type { MaybeRefOrGetter } from 'vue';

/**
 * The state version a write against one Screen states it was built against.
 *
 * Placing a graphics Template is a read-modify-write of the Screen — its whole
 * Broadcast Graphics stack in one library, its whole Feature Match Layout in the other
 * — so the write says which version it was built against and the server refuses it if
 * the Screen has moved. Without one the server has nothing to compare and the write
 * would silently discard whatever another author did in the meantime.
 *
 * A Screen missing from the store falls back to 0, which is a real version rather than
 * a skip: it is what a Screen that has never been written carries, so it matches one of
 * those and is refused by every other Screen.
 */
export function useScreenPlacementVersion(screenId: MaybeRefOrGetter<number>) {
	const screenStore = useScreenStore();
	return computed(() =>
		screenStore.screens.find(screen => screen.id === toValue(screenId))?.stateVersion ?? 0,
	);
}
