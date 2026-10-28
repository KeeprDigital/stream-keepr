import type { InjectionKey, MaybeRefOrGetter, Ref } from 'vue';
import { computed, inject, onScopeDispose, provide, ref, shallowReactive, shallowRef, toValue, watch } from 'vue';
import { createGuardedSequence } from '~/utils/guardedSequence';
import { preloadImages } from '~/utils/preloadImage';

/**
 * How long a rendering waits for what replaces it before showing it anyway. A
 * read or image that hangs must not hold program on the outgoing mode forever;
 * what has not settled by then fills in on program.
 */
export const SCREEN_MODE_READY_TIMEOUT_MS = 10_000;

interface ScreenModeReadinessRegistry {
	declare: (ready: () => boolean) => () => void;
}

const SCREEN_MODE_READINESS: InjectionKey<ScreenModeReadinessRegistry> = Symbol('screen-mode-readiness');

/**
 * Rendering Readiness, as one Screen Mode rendering's host sees it: whether
 * every declaration made inside it holds. Nothing declared is not ready, since
 * a mode's display is an async component that declares only once it has
 * loaded.
 */
export function provideScreenModeReadiness() {
	const declarations = shallowReactive(new Set<() => boolean>());
	provide(SCREEN_MODE_READINESS, {
		declare(ready) {
			declarations.add(ready);
			return () => declarations.delete(ready);
		},
	});
	return {
		declared: computed(() => declarations.size > 0 && [...declarations].every(ready => ready())),
	};
}

/**
 * Declares whether what this component shows has settled: its first read
 * answered or failed, and whatever it stages loaded. Every Screen Mode display
 * declares, through `ScreenModeBase` or directly; a part of one that loads on
 * its own may declare too. Outside a rendering host it does nothing.
 */
export function useScreenModeReady(ready: MaybeRefOrGetter<boolean>) {
	const registry = inject(SCREEN_MODE_READINESS, null);
	if (!registry)
		return;
	onScopeDispose(registry.declare(() => toValue(ready)));
}

/**
 * Holds what a rendering shows until the images of what replaces it have
 * loaded, so a change, a new page among them, swaps in whole rather than
 * painting card by card. A newer change supersedes one still loading; a
 * failed image counts as loaded, leaving its fallback to the rendering.
 */
export function useStagedScreenContent<T>(
	content: () => T,
	imageUrls: (content: T) => Iterable<string>,
): { shown: Readonly<Ref<T>>; staging: Readonly<Ref<boolean>> } {
	const shown = shallowRef(content()) as Ref<T>;
	const staging = ref(true);
	const stages = createGuardedSequence();

	watch(content, async (next) => {
		const flight = stages.begin();
		staging.value = true;
		await preloadImages(imageUrls(next));
		if (flight.stale)
			return;
		shown.value = next;
		staging.value = false;
	}, { immediate: true });

	onScopeDispose(() => stages.supersede());

	return {
		shown: computed(() => shown.value),
		staging: computed(() => staging.value),
	};
}
