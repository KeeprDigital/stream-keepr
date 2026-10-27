import type { DOMWrapper, VueWrapper } from '@vue/test-utils';

/**
 * Fire `load` on every image in `rendering`. happy-dom loads a data URI, such
 * as a sample card's drawn face, the moment its `src` is set, before Vue
 * listens for it, so a rendering waiting on that load would wait for ever.
 */
export function loadDrawnImages(rendering: VueWrapper | DOMWrapper<Element>) {
	for (const image of rendering.findAll('img'))
		image.element.dispatchEvent(new Event('load'));
}
