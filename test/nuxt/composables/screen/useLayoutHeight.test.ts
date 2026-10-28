import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { useLayoutHeight } from '~/composables/screen/useLayoutHeight';

describe('useLayoutHeight', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	// The layout height, which the Screen's scale leaves alone, never the scaled bounding box.
	it('reads an element\'s layout height once it is laid out', () => {
		vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(42);
		vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 21 } as DOMRect);
		let height!: ReturnType<typeof useLayoutHeight>;

		mount(defineComponent({
			setup() {
				const target = ref<HTMLElement | null>(null);
				height = useLayoutHeight(target);
				return () => h('div', { ref: target });
			},
		}));

		expect(height.value).toBe(42);
	});

	it('is 0 before there is an element to read', () => {
		let height!: ReturnType<typeof useLayoutHeight>;

		mount(defineComponent({
			setup() {
				height = useLayoutHeight(ref(null));
				return () => h('div');
			},
		}));

		expect(height.value).toBe(0);
	});
});
