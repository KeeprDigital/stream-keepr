import type { MaybeElementRef } from '@vueuse/core';
import { unrefElement, useResizeObserver } from '@vueuse/core';

/**
 * An element's layout height in Event Canvas px, kept current as it resizes.
 * Its layout box, not its bounding box: the Screen scales the canvas to its
 * window, which a bounding box would carry and a layout must not. 0 until the
 * element is laid out.
 */
export function useLayoutHeight(target: MaybeElementRef): Ref<number> {
	const height = ref(0);
	function measure() {
		const element = unrefElement(target) as HTMLElement | null | undefined;
		height.value = element?.offsetHeight ?? 0;
	}
	onMounted(measure);
	useResizeObserver(target, measure);
	return height;
}
