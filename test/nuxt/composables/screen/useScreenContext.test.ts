import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockScreen } from '~~/test/helpers/fixtures';

// Mock getDefaultConfigForMode
vi.mock('~~/shared/types/screenConfig', async (importOriginal) => {
	const mod = await importOriginal() as any;
	return {
		...mod,
		getDefaultConfigForMode: vi.fn((mode: string) => {
			if (mode === 'match')
				return { matchId: null };
			if (mode === 'deck')
				return { playerId: null };
			return {};
		}),
	};
});

/** Mount a parent that provides and a child that injects, return the child's result */
function withScreenContext<T>(
	context: ReturnType<typeof provideScreenContext> extends void ? Parameters<typeof provideScreenContext>[0] : never,
	childSetup: () => T,
): T {
	let result!: T;
	const Child = defineComponent({
		setup() {
			result = childSetup();
			return () => h('div');
		},
	});
	const Parent = defineComponent({
		setup() {
			provideScreenContext(context);
			return () => h(Child);
		},
	});
	mount(Parent);
	return result;
}

describe('useScreenContext', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns the provided context in a descendant component', () => {
		const screen = ref(createMockScreen({ id: 42 }) as any);
		const ctx = {
			screen,
			eventId: computed(() => 7),
			interactive: ref(true),
			overlayContainer: ref<HTMLElement | null>(null),
		};

		const { screen: injectedScreen, eventId, interactive } = withScreenContext(ctx, () => useScreenContext());

		expect(injectedScreen.value?.id).toBe(42);
		expect(eventId.value).toBe(7);
		expect(interactive.value).toBe(true);
	});
});

describe('useScreenModeConfig', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns defaults when no stored config exists for mode', () => {
		const screen = ref(createMockScreen({ modeConfigs: null }) as any);
		const ctx = { screen, eventId: computed(() => 1), interactive: ref(false), overlayContainer: ref<HTMLElement | null>(null) };

		const config = withScreenContext(ctx, () => useScreenModeConfig('deck'));

		expect(config.value.playerId).toBeNull();
	});

	it('merges stored config over defaults', () => {
		const screen = ref(createMockScreen({
			modeConfigs: { deck: { playerId: 5 } } as any,
		}) as any);
		const ctx = { screen, eventId: computed(() => 1), interactive: ref(false), overlayContainer: ref<HTMLElement | null>(null) };

		const config = withScreenContext(ctx, () => useScreenModeConfig('deck'));

		expect(config.value.playerId).toBe(5);
	});

	it('is reactive to screen modeConfig changes', async () => {
		const screen = ref(createMockScreen({ modeConfigs: { deck: { playerId: 1 } } as any }) as any);
		const ctx = { screen, eventId: computed(() => 1), interactive: ref(false), overlayContainer: ref<HTMLElement | null>(null) };

		const config = withScreenContext(ctx, () => useScreenModeConfig('deck'));
		expect(config.value.playerId).toBe(1);

		screen.value = { ...screen.value, modeConfigs: { deck: { playerId: 99 } } };
		await nextTick();

		expect(config.value.playerId).toBe(99);
	});
});
