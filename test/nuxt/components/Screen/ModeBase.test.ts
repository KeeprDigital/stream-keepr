import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';
import ModeBase from '~/components/Screen/ModeBase.vue';
import { provideScreenModeReadiness } from '~/modules/screen-mode/readiness';

async function mountComponent(props: { error: string | null; empty: boolean }) {
	return mount(ModeBase, {
		props: { ...props, ready: true },
		slots: {
			default: '<div data-testid="mode-content">Visible content</div>',
		},
	});
}

describe('screenModeBase', () => {
	it('renders slot content when not error or empty', async () => {
		const wrapper = await mountComponent({ error: null, empty: false });

		expect(wrapper.find('[data-testid="mode-content"]').exists()).toBe(true);
	});

	it('renders blank on error', async () => {
		const wrapper = await mountComponent({ error: 'Failed', empty: false });

		expect(wrapper.find('[data-testid="mode-content"]').exists()).toBe(false);
		expect(wrapper.text()).toBe('');
	});

	it('renders blank when empty', async () => {
		const wrapper = await mountComponent({ error: null, empty: true });

		expect(wrapper.find('[data-testid="mode-content"]').exists()).toBe(false);
		expect(wrapper.text()).toBe('');
	});

	it.each([true, false])('declares ready=%s to its rendering host', async (ready) => {
		let declared: ReturnType<typeof provideScreenModeReadiness>['declared'] | undefined;
		mount(defineComponent({
			setup() {
				declared = provideScreenModeReadiness().declared;
				return () => h(ModeBase, { error: null, ready });
			},
		}));

		expect(declared?.value).toBe(ready);
	});
});
