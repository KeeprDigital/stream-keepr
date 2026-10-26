import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, reactive } from 'vue';
import { useUnsavedChanges } from '~/composables/ui/useUnsavedChanges';

const handleSubmit = vi.fn();
mockNuxtImport('useEventConfigSubmit', () => () => ({ handleSubmit }));
mockNuxtImport('useOverlay', () => () => ({
	create: () => ({
		open: () => ({
			result: Promise.resolve(true),
		}),
	}),
}));
mockNuxtImport('onBeforeRouteLeave', () => () => {});

/** The Event as the store holds it; a save that lands writes its answer here. */
const event = reactive({ name: 'Regional', cardTimeout: 10 });

/** Stores the update the way the real Event store does: it holds the answer before resolving. */
function storeAnswering(answer: (update: Record<string, unknown>) => Partial<typeof event>, succeeded: unknown = true) {
	handleSubmit.mockImplementation(async (update: Record<string, unknown>) => {
		Object.assign(event, answer(update));
		return succeeded;
	});
}

type Form = ReturnType<typeof useEventConfigForm<{ name: string; cardTimeout: number }>>;

/** Runs the composable inside a page that has installed the unsaved-changes guard. */
function mountForm(options: { validate?: () => boolean } = {}) {
	let form!: Form;
	let page!: ReturnType<typeof useUnsavedChanges>;
	const Card = defineComponent({
		setup() {
			form = useEventConfigForm({
				initialData: computed(() => ({ name: event.name, cardTimeout: event.cardTimeout })),
				toUpdate: changes => ({
					...changes,
					...('name' in changes
						? {
								name: `${changes.name}`.trim(),
							}
						: {}),
				}),
				...options,
			});
			return () => null;
		},
	});
	mount(defineComponent({
		setup() {
			page = useUnsavedChanges();
			return () => h(Card);
		},
	}));
	return {
		form,
		pageIsDirty: () => page.isDirty.value,
	};
}

describe('useEventConfigForm', () => {
	beforeEach(() => {
		handleSubmit.mockReset();
		Object.assign(event, { name: 'Regional', cardTimeout: 10 });
	});

	it('tells the page it has unsaved changes while the form is edited', () => {
		const { form, pageIsDirty } = mountForm();

		form.formData.value.cardTimeout = 30;

		expect(pageIsDirty()).toBe(true);
	});

	it('saves only the changed fields, mapped to the Event update', async () => {
		storeAnswering(update => update);
		const { form } = mountForm();

		form.formData.value.name = '  Regional 2026  ';
		await form.save();

		expect(handleSubmit).toHaveBeenCalledWith({ name: 'Regional 2026' });
	});

	it('reads clean once a save the server normalized lands', async () => {
		storeAnswering(update => update);
		const { form, pageIsDirty } = mountForm();

		form.formData.value.name = '  Regional 2026  ';
		await form.save();

		expect(form.formData.value.name).toBe('Regional 2026');
		expect(pageIsDirty()).toBe(false);
	});

	it('refuses to save when validation fails', async () => {
		const { form } = mountForm({
			validate: () => false,
		});

		form.formData.value.cardTimeout = 30;
		await form.save();

		expect(handleSubmit).not.toHaveBeenCalled();
	});

	it('keeps the edit when the save fails', async () => {
		storeAnswering(() => ({}), null);
		const { form, pageIsDirty } = mountForm();

		form.formData.value.name = 'Regional 2026 ';
		await form.save();

		expect(form.formData.value.name).toBe('Regional 2026 ');
		expect(pageIsDirty()).toBe(true);
	});
});
