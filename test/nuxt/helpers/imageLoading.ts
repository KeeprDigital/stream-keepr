import { vi } from 'vitest';

/**
 * The browser's off-DOM image loading, faked at the `Image` boundary. Every
 * image loads on the next microtask, unless the test fails its URL or holds
 * it until released.
 */
export function stubImageLoading() {
	const requested: string[] = [];
	const failed = new Set<string>();
	const held = new Map<string, Array<() => void>>();

	class FakeImage {
		complete = false;
		onload: (() => void) | null = null;
		onerror: (() => void) | null = null;
		#src = '';

		set src(value: string) {
			this.#src = value;
			requested.push(value);
			const settle = () => {
				this.complete = true;
				if (failed.has(value))
					this.onerror?.();
				else
					this.onload?.();
			};
			const waiting = held.get(value);
			if (waiting)
				waiting.push(settle);
			else
				queueMicrotask(settle);
		}

		get src() {
			return this.#src;
		}

		get naturalWidth() {
			return failed.has(this.#src)
				? 0
				: 488;
		}

		decode() {
			return Promise.resolve();
		}
	}

	vi.stubGlobal('Image', FakeImage);

	return {
		/** Every URL an image was asked to load, in order. */
		requested,
		fail(url: string) {
			failed.add(url);
		},
		/** Keeps every image of `url` loading until `release(url)`. */
		hold(url: string) {
			held.set(url, held.get(url) ?? []);
		},
		release(url: string) {
			const waiting = held.get(url) ?? [];
			held.delete(url);
			for (const settle of waiting)
				settle();
		},
		reset() {
			requested.length = 0;
			failed.clear();
			held.clear();
		},
	};
}
