import { afterEach, describe, expect, it } from 'vitest';
import { waitForRenderedMedia } from '~/utils/renderedMediaReadiness';

let element: HTMLElement | undefined;

afterEach(() => {
	element?.remove();
	element = undefined;
});

function rendered(html: string) {
	element = document.createElement('div');
	element.innerHTML = html;
	document.body.appendChild(element);
	return element;
}

/** Whether `promise` settles before the microtasks queued now have run. */
async function settlesPromptly(promise: Promise<unknown>) {
	let settled = false;
	void promise.then(() => {
		settled = true;
	});
	for (let tick = 0; tick < 5; tick++)
		await Promise.resolve();
	return settled;
}

describe('waitForRenderedMedia', () => {
	it('waits while a part of the rendering marks itself pending', async () => {
		const root = rendered('<div data-render-pending></div>');
		const ready = waitForRenderedMedia(root);
		expect(await settlesPromptly(ready)).toBe(false);

		root.firstElementChild!.removeAttribute('data-render-pending');

		await expect(ready).resolves.toBeUndefined();
	});

	// A broken image is `complete` and fires nothing more, so waiting on its events would hang.
	it('settles on an image that already failed', async () => {
		const root = rendered('<img src="https://example.test/missing.png">');
		const image = root.querySelector('img')!;
		Object.defineProperty(image, 'complete', { configurable: true, value: true });
		Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 0 });

		expect(await settlesPromptly(waitForRenderedMedia(root))).toBe(true);
	});
});
