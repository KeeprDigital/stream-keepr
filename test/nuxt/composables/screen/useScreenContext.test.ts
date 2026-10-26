import type { ScreenContext } from '~/composables/screen/useScreenContext';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { getDefaultConfigForMode, resolveScreenModeConfig } from '~~/shared/types/screenConfig';
import { createMockScreen } from '~~/test/helpers/fixtures';

function screenContext(screen = createMockScreen({ id: 42 })): ScreenContext {
	return {
		screen: ref(screen as any),
		eventId: computed(() => 7),
		interactive: ref(true),
		overlayContainer: ref<HTMLElement | null>(null),
	};
}

/** Runs `childSetup` in a descendant of a component that provides `context`. */
function withScreenContext<T>(context: ScreenContext, childSetup: () => T): T {
	let result!: T;
	const Child = defineComponent({
		setup() {
			result = childSetup();
			return () => h('div');
		},
	});
	mount(defineComponent({
		setup() {
			provideScreenContext(context);
			return () => h(Child);
		},
	}));
	return result;
}

describe('useScreenContext', () => {
	it('returns the context an ancestor provides', () => {
		const context = screenContext();

		expect(withScreenContext(context, () => useScreenContext())).toBe(context);
	});

	it('sets a composable up against a given context outside any provider, and only it (#780)', () => {
		const context = screenContext();

		expect(runInScreenContext(context, () => useScreenContext())).toBe(context);
		expect(() => useScreenContext()).toThrow('outside of a screen context');
	});
});

describe('useScreenModeConfig', () => {
	it('reads the mode\'s defaults when the Screen stores nothing for it', () => {
		const context = screenContext(createMockScreen({ modeConfigs: null }));

		const config = withScreenContext(context, () => useScreenModeConfig('deck'));

		expect(config.value).toEqual(getDefaultConfigForMode('deck'));
	});

	it('reads what the Screen stores, completed with the mode\'s defaults', () => {
		const modeConfigs = { deck: { deckSource: { type: 'player', playerId: 5 } } } as any;
		const context = screenContext(createMockScreen({ modeConfigs }));

		const config = withScreenContext(context, () => useScreenModeConfig('deck'));

		expect(config.value.deckSource).toEqual({ type: 'player', playerId: 5 });
		expect(config.value).toEqual(resolveScreenModeConfig(modeConfigs, 'deck'));
	});
});
