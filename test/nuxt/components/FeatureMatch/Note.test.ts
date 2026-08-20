import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';

const UButtonStub = defineComponent({
	props: {
		label: String,
		disabled: Boolean,
		loading: Boolean,
	},
	emits: ['click'],
	template: '<button type="button" :disabled="disabled" :data-loading="String(loading)" @click="$emit(\'click\')"><slot>{{ label }}</slot></button>',
});

const UTextareaStub = defineComponent({
	props: { modelValue: String, maxlength: Number },
	emits: ['update:modelValue', 'keydown'],
	template: '<textarea data-testid="note-input" :value="modelValue" :maxlength="maxlength" @input="$emit(\'update:modelValue\', $event.target.value)" @keydown="$emit(\'keydown\', $event)" />',
});

async function mountNote(props: Record<string, unknown>) {
	const { default: FeatureMatchNote } = await import('~/components/FeatureMatch/Note.vue');
	return mount(FeatureMatchNote, {
		props: {
			note: '',
			noteKey: 1,
			save: vi.fn().mockResolvedValue(undefined),
			...props,
		},
		global: {
			stubs: {
				UButton: UButtonStub,
				UTextarea: UTextareaStub,
				UIcon: true,
			},
		},
	});
}

describe('featureMatchNote', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('renders plain multiline text, a small empty state, and an expandable long Note', async () => {
		const empty = await mountNote({ note: '' });
		expect(empty.get('[data-testid="note-empty"]').text()).toContain('No production note');

		const note = Array.from({ length: 6 }, (_, index) => `Line ${index + 1}`).join('\n');
		const filled = await mountNote({ note });
		expect(filled.get('[data-testid="note-text"]').text()).toContain('Line 1');
		expect(filled.get('[data-testid="note-text"]').attributes('style')).toContain('white-space: pre-wrap');
		expect(filled.get('[data-testid="note-text"]').classes()).toContain('line-clamp-4');

		await filled.get('[data-testid="note-expand"]').trigger('click');
		expect(filled.get('[data-testid="note-text"]').classes()).not.toContain('line-clamp-4');
	});

	it('keeps the editor open while saving and saves with Ctrl+Enter while Enter remains multiline', async () => {
		let finishSave!: () => void;
		const save = vi.fn(() => new Promise<void>((resolve) => {
			finishSave = resolve;
		}));
		const wrapper = await mountNote({ note: 'Original', save });
		await wrapper.get('[data-testid="note-edit"]').trigger('click');
		await wrapper.get('[data-testid="note-input"]').setValue('First\nSecond');

		await wrapper.get('[data-testid="note-input"]').trigger('keydown', { key: 'Enter' });
		expect(save).not.toHaveBeenCalled();
		await wrapper.get('[data-testid="note-input"]').trigger('keydown', { key: 'Enter', ctrlKey: true });
		await Promise.resolve();

		expect(save).toHaveBeenCalledWith('First\nSecond');
		expect(wrapper.find('[data-testid="note-input"]').exists()).toBe(true);
		expect(wrapper.get('[data-testid="note-save"]').attributes('data-loading')).toBe('true');

		finishSave();
		await vi.waitFor(() => expect(wrapper.find('[data-testid="note-input"]').exists()).toBe(false));
	});

	it('retains a failed draft and does not replace it when a peer Note arrives mid-edit', async () => {
		const save = vi.fn().mockRejectedValue(new Error('Network unavailable'));
		const wrapper = await mountNote({ note: 'Original', save });
		await wrapper.get('[data-testid="note-edit"]').trigger('click');
		await wrapper.get('[data-testid="note-input"]').setValue('Local draft');
		await wrapper.setProps({ note: 'Peer update', remoteChanged: true });

		expect((wrapper.get('[data-testid="note-input"]').element as HTMLTextAreaElement).value).toBe('Local draft');
		await wrapper.get('[data-testid="note-save"]').trigger('click');
		await vi.waitFor(() => expect(wrapper.get('[data-testid="note-error"]').text()).toContain('Network unavailable'));
		expect((wrapper.get('[data-testid="note-input"]').element as HTMLTextAreaElement).value).toBe('Local draft');
		expect(wrapper.attributes('data-remote-changed')).toBe('true');
	});

	it('requires a visible confirmation before clearing the only Note copy', async () => {
		const save = vi.fn().mockResolvedValue(undefined);
		const wrapper = await mountNote({ note: 'Important context', save });
		await wrapper.get('[data-testid="note-edit"]').trigger('click');
		await wrapper.get('[data-testid="note-clear"]').trigger('click');

		expect(save).not.toHaveBeenCalled();
		expect(wrapper.get('[data-testid="note-clear-confirmation"]').text()).toContain('Important context');
		await wrapper.get('[data-testid="note-confirm-clear"]').trigger('click');
		await vi.waitFor(() => expect(save).toHaveBeenCalledWith(''));
	});

	it('cancels without changing the authoritative Note and supports Cmd+Enter saving', async () => {
		const save = vi.fn().mockResolvedValue(undefined);
		const wrapper = await mountNote({ note: 'Authoritative Note', save });
		await wrapper.get('[data-testid="note-edit"]').trigger('click');
		await wrapper.get('[data-testid="note-input"]').setValue('Discard this draft');
		const cancel = wrapper.findAll('button').find(button => button.text() === 'Cancel');
		expect(cancel).toBeDefined();
		await cancel!.trigger('click');

		expect(save).not.toHaveBeenCalled();
		expect(wrapper.get('[data-testid="note-text"]').text()).toBe('Authoritative Note');

		await wrapper.get('[data-testid="note-edit"]').trigger('click');
		await wrapper.get('[data-testid="note-input"]').setValue('Saved from a Mac');
		await wrapper.get('[data-testid="note-input"]').trigger('keydown', { key: 'Enter', metaKey: true });
		await vi.waitFor(() => expect(save).toHaveBeenCalledWith('Saved from a Mac'));
	});

	it('renders Note contents strictly as plain text', async () => {
		const wrapper = await mountNote({ note: '<strong>Not markup</strong>\nSecond line' });

		expect(wrapper.get('[data-testid="note-text"]').text()).toBe('<strong>Not markup</strong>\nSecond line');
		expect(wrapper.find('strong').exists()).toBe(false);
	});
});
