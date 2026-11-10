import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';

const clockSynchronized = ref(false);
const session = { id: 55, sequence: 1 };
const sessionStore = {
	sessions: new Map([
		[7, session],
	]),
	get clockSynchronized() {
		return clockSynchronized.value;
	},
	serverNow: vi.fn(() => 1_000_000),
	animationProjection: vi.fn(() => ({})),
	hasActiveSocialProfileRotation: vi.fn(() => clockSynchronized.value),
};

mockNuxtImport('useBroadcastGraphicsLiveSessionStore', () => () => sessionStore);

describe('useBroadcastGraphicsPlayoutClock', () => {
	let nextFrame: FrameRequestCallback | undefined;
	let wrapper: ReturnType<typeof mount> | undefined;

	beforeEach(() => {
		clockSynchronized.value = false;
		nextFrame = undefined;
		vi.clearAllMocks();
		vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
			nextFrame = callback;
			return 17;
		}));
		vi.stubGlobal('cancelAnimationFrame', vi.fn());
		wrapper = undefined;
	});

	afterEach(() => {
		wrapper?.unmount();
		vi.unstubAllGlobals();
	});

	it('restarts projection frames when synchronized server time recovers without a session command', async () => {
		wrapper = mount(defineComponent({
			setup() {
				useBroadcastGraphicsPlayoutClock(7, []);
				return () => h('div');
			},
		}));
		await nextTick();
		nextFrame?.(1_000_000);
		expect(cancelAnimationFrame).toHaveBeenCalledWith(17);
		vi.mocked(requestAnimationFrame).mockClear();

		clockSynchronized.value = true;
		await nextTick();

		expect(requestAnimationFrame).toHaveBeenCalledOnce();
	});

	// A stored graphic or channel can start motion with no session command: a
	// looping recipe saved onto a graphic resting on air.
	it.each([
		{ changed: 'graphics' },
		{ changed: 'channels' },
	] as const)('advances again when the stored $changed change', async ({ changed }) => {
		const stored = {
			graphics: ref<any[]>([]),
			channels: ref<any[]>([]),
		};
		let now!: Readonly<{ value: number }>;
		sessionStore.serverNow.mockReturnValue(1_000_000);
		wrapper = mount(defineComponent({
			setup() {
				now = useBroadcastGraphicsPlayoutClock(7, stored.graphics, stored.channels);
				return () => h('div');
			},
		}));
		await nextTick();
		nextFrame?.(1_000_000);
		sessionStore.serverNow.mockReturnValue(1_000_500);

		stored[changed].value = [
			{ id: 'lower-third' },
		];
		await nextTick();

		expect(now.value).toBe(1_000_500);
	});
});
