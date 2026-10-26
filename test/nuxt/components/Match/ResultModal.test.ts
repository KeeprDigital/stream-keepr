import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockMatch } from '~~/test/helpers/fixtures';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';

const mockEventStore = {
	eventId: 1,
};

const mockMatchStore = {
	updateMatch: vi.fn(),
};

const mockToast = {
	add: vi.fn(),
};

mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('useMatchStore', () => () => mockMatchStore);
mockNuxtImport('useToast', () => () => mockToast);

async function mountComponent() {
	const { default: ResultModal } = await import('~/components/Match/ResultModal.vue');

	return mount(ResultModal, {
		props: {
			match: createMockMatch({
				player1Data: { name: 'Alice' } as never,
				player2Data: { name: 'Bob' } as never,
			}),
			bestOf: 3,
		},
		global: {
			stubs: nuxtUiStubs,
		},
	});
}

describe('matchResultModal', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('saves when the result form is submitted', async () => {
		mockMatchStore.updateMatch.mockResolvedValue(createMockMatch({ hasResult: true }));
		const wrapper = await mountComponent();

		const inputs = wrapper.findAll('input');
		await inputs[0]!.setValue('2');
		await inputs[1]!.setValue('1');
		await wrapper.get('form').trigger('submit');
		await flushPromises();

		const submitButton = wrapper.findAll('button').find(button => button.text() === 'Save Result')!;
		expect(submitButton.attributes('type')).toBe('submit');
		expect(submitButton.attributes('form')).toBe(wrapper.get('form').attributes('id'));
		expect(mockMatchStore.updateMatch).toHaveBeenCalledWith(1, expect.any(Number), expect.objectContaining({
			hasResult: true,
			player1GameWins: 2,
			player2GameWins: 1,
			resultString: '2-1',
		}));
		expect(wrapper.emitted('saved')).toEqual([[]]);
		expect(wrapper.emitted('close')).toEqual([[]]);
	});
});
