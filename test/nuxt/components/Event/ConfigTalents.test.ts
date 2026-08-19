import type { DropdownMenuItem } from '@nuxt/ui';
import type { Talent } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import { mountUnderPageGuard } from '~~/test/helpers/mountUnderPageGuard';

function talent(id: number, name: string, socialProfiles: Talent['socialProfiles'] = {}): Talent {
	return {
		id,
		eventId: 1,
		name,
		socialProfiles,
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		updatedAt: new Date('2026-01-01T00:00:00.000Z'),
	};
}

const ALICE = talent(11, 'Alice');
const BOB = talent(12, 'Bob');
const BOB_AGAIN = talent(13, 'Bob');

mockNuxtImport('useOverlay', () => () => ({
	create: () => ({ open: () => ({ result: Promise.resolve(true) }) }),
}));
mockNuxtImport('onBeforeRouteLeave', () => () => {});

const UCardStub = defineComponent({
	name: 'UCard',
	template: '<section><slot /><slot name="footer" /></section>',
});

const UIEmptyStateStub = defineComponent({
	name: 'UIEmptyState',
	template: '<p data-empty />',
});

const UInputStub = defineComponent({
	name: 'UInput',
	props: {
		modelValue: { type: String, required: false },
		icon: { type: String, required: false },
	},
	emits: ['update:modelValue'],
	template: '<input :value="modelValue" :data-icon="icon" @input="$emit(\'update:modelValue\', $event.target.value)" />',
});

const UButtonStub = defineComponent({
	name: 'UButton',
	props: {
		label: { type: String, required: false },
		icon: { type: String, required: false },
		disabled: { type: Boolean, required: false },
		type: { type: String, required: false },
	},
	emits: ['click'],
	template: '<button :data-label="label" :data-icon="icon" :disabled="disabled" :type="type" @click="$emit(\'click\')">{{ label }}</button>',
});

const UDropdownMenuStub = defineComponent({
	name: 'UDropdownMenu',
	props: { items: { type: Array, default: () => [] } },
	template: '<div data-menu><slot /></div>',
});

const UTooltipStub = defineComponent({
	name: 'UTooltip',
	template: '<div><slot /></div>',
});

const UModalStub = defineComponent({
	name: 'UModal',
	props: { open: { type: Boolean, default: false } },
	template: '<section v-if="open" data-editor><slot name="body" /><slot name="footer" /></section>',
});

const UFormStub = defineComponent({
	name: 'UForm',
	emits: ['submit'],
	template: '<form @submit.prevent="$emit(\'submit\')"><slot /></form>',
});

const UFormFieldStub = defineComponent({
	name: 'UFormField',
	props: {
		name: { type: String, required: false },
		label: { type: String, required: false },
		error: { type: String, required: false },
	},
	template: '<label :data-field="name"><span data-field-label>{{ label }}</span><slot /><span v-if="error" data-error>{{ error }}</span></label>',
});

const UIconStub = defineComponent({
	name: 'UIcon',
	props: { name: { type: String, required: true } },
	template: '<span :data-icon="name" />',
});

const stubs = {
	UCard: UCardStub,
	UIEmptyState: UIEmptyStateStub,
	UInput: UInputStub,
	UButton: UButtonStub,
	UDropdownMenu: UDropdownMenuStub,
	UTooltip: UTooltipStub,
	UModal: UModalStub,
	UForm: UFormStub,
	UFormField: UFormFieldStub,
	UIcon: UIconStub,
};

enableAutoUnmount(afterEach);

const componentPath = '../../../../app/components/Event/ConfigTalents.vue';
const mountOptions = { attachTo: document.body, global: { stubs } };

async function mountComponent(talents: Talent[]) {
	const { default: ConfigTalents } = await import(componentPath);
	return mount(ConfigTalents, { ...mountOptions, props: { talents } });
}

type Wrapper = Awaited<ReturnType<typeof mountComponent>>;

async function mountUnderGuard(talents: Talent[]) {
	const { default: ConfigTalents } = await import(componentPath);
	return mountUnderPageGuard<Wrapper>(ConfigTalents, { ...mountOptions, props: { talents } });
}

function chooseRowAction(wrapper: Wrapper, index: number, label: string) {
	const menus = wrapper.findAllComponents(UDropdownMenuStub);
	const items = menus[index]!.props('items') as DropdownMenuItem[];
	const action = items.find(item => item.label === label);
	if (!action)
		throw new Error(`Row ${index} offers no "${label}" action`);
	action.onSelect?.(new Event('select') as never);
}

function button(wrapper: Wrapper, label: string) {
	return wrapper.findAll(`[data-label="${label}"]`).at(-1)!;
}

function profileInput(wrapper: Wrapper, network: string) {
	return wrapper.get(`[data-social-network="${network}"]`);
}

async function finishEditor(wrapper: Wrapper) {
	await button(wrapper, 'Done').trigger('click');
	await flushPromises();
}

function submitted(wrapper: Wrapper) {
	const events = wrapper.emitted('submit');
	if (!events?.length)
		throw new Error('The card emitted no submit');
	return events.at(-1)![0] as Array<{ id?: number; name: string; socialProfiles: Talent['socialProfiles'] }>;
}

describe('event config Talents', () => {
	it('offers a focused editor with six icon-labelled optional Social Profile fields', async () => {
		const wrapper = await mountComponent([ALICE]);
		chooseRowAction(wrapper, 0, 'Edit');
		await flushPromises();

		expect(wrapper.find('[data-editor]').exists()).toBe(true);
		expect(wrapper.findAll('[data-social-network]')).toHaveLength(6);
		expect(wrapper.findAll('[data-field-label]').map(label => label.text())).toEqual([
			'Name',
			'Twitch',
			'YouTube',
			'X',
			'Instagram',
			'TikTok',
			'Bluesky',
		]);
		expect(profileInput(wrapper, 'twitch').attributes('data-icon')).toBe('i-simple-icons-twitch');
		expect(profileInput(wrapper, 'bluesky').attributes('data-icon')).toBe('i-simple-icons-bluesky');
	});

	it('normalizes profiles and keeps the Talent id through the staged save', async () => {
		const wrapper = await mountComponent([ALICE]);
		chooseRowAction(wrapper, 0, 'Edit');
		await flushPromises();

		await wrapper.get('[data-field="name"] input').setValue(' Alicia ');
		await profileInput(wrapper, 'twitch').setValue('  @AliceLive ');
		await profileInput(wrapper, 'youtube').setValue('https://youtube.com/@AliceVideo');
		await finishEditor(wrapper);
		await button(wrapper, 'Save').trigger('click');

		expect(submitted(wrapper)).toEqual([{
			id: ALICE.id,
			name: 'Alicia',
			socialProfiles: { twitch: 'AliceLive', youtube: 'AliceVideo' },
		}]);
	});

	it('keeps a malformed profile error on its network field and does not stage it', async () => {
		const wrapper = await mountComponent([ALICE]);
		chooseRowAction(wrapper, 0, 'Edit');
		await flushPromises();

		await profileInput(wrapper, 'x').setValue('two words');
		await finishEditor(wrapper);

		expect(wrapper.get('[data-field="socialProfiles.x"] [data-error]').text()).toContain('valid X handle');
		expect(wrapper.find('[data-editor]').exists()).toBe(true);
		expect(wrapper.emitted('submit')).toBeUndefined();
	});

	it('replaces the complete profile set and treats a blank field as removal', async () => {
		const wrapper = await mountComponent([talent(11, 'Alice', { twitch: 'Old', instagram: 'Kept' })]);
		chooseRowAction(wrapper, 0, 'Edit');
		await flushPromises();

		await profileInput(wrapper, 'twitch').setValue(' ');
		await profileInput(wrapper, 'x').setValue('@New');
		await finishEditor(wrapper);
		await button(wrapper, 'Save').trigger('click');

		expect(submitted(wrapper)[0]!.socialProfiles).toEqual({ instagram: 'Kept', x: 'New' });
	});

	it('allows two Talents to share one handle', async () => {
		const wrapper = await mountComponent([
			talent(11, 'Alice', { twitch: 'Shared' }),
			talent(12, 'Bob'),
		]);
		chooseRowAction(wrapper, 1, 'Edit');
		await flushPromises();

		await profileInput(wrapper, 'twitch').setValue('Shared');
		await finishEditor(wrapper);
		await button(wrapper, 'Save').trigger('click');

		expect(submitted(wrapper).map(row => row.socialProfiles.twitch)).toEqual(['Shared', 'Shared']);
	});

	it('distinguishes namesakes by id when one is removed', async () => {
		const wrapper = await mountComponent([BOB, BOB_AGAIN]);
		chooseRowAction(wrapper, 0, 'Remove');
		await flushPromises();
		await button(wrapper, 'Save').trigger('click');

		expect(submitted(wrapper)).toEqual([{ id: BOB_AGAIN.id, name: 'Bob', socialProfiles: {} }]);
	});

	it('adds a normalized Talent row with no id', async () => {
		const wrapper = await mountComponent([ALICE]);
		await button(wrapper, 'Add talent').trigger('click');
		await flushPromises();

		await wrapper.get('[data-field="name"] input').setValue('Dana');
		await profileInput(wrapper, 'bluesky').setValue('https://bsky.app/profile/dana.bsky.social');
		await finishEditor(wrapper);
		await button(wrapper, 'Save').trigger('click');

		expect(submitted(wrapper)).toEqual([
			{ id: ALICE.id, name: 'Alice', socialProfiles: {} },
			{ name: 'Dana', socialProfiles: { bluesky: 'dana.bsky.social' } },
		]);
	});

	it('registers staged changes with the page guard and Reset restores the response', async () => {
		const { wrapper, pageIsDirty } = await mountUnderGuard([ALICE, BOB]);
		await flushPromises();

		expect(pageIsDirty()).toBe(false);
		chooseRowAction(wrapper, 1, 'Remove');
		await flushPromises();
		expect(pageIsDirty()).toBe(true);

		await button(wrapper, 'Reset').trigger('click');
		expect(pageIsDirty()).toBe(false);
		expect(wrapper.findAllComponents(UDropdownMenuStub)).toHaveLength(2);
	});

	it('uses ordinary buttons for both Save branches', async () => {
		const wrapper = await mountComponent([ALICE]);
		expect(wrapper.findComponent(UTooltipStub).exists()).toBe(false);
		expect(button(wrapper, 'Save').attributes('type')).toBe('button');

		await button(wrapper, 'Add talent').trigger('click');
		await flushPromises();
		expect(wrapper.findComponent(UTooltipStub).exists()).toBe(true);
		expect(button(wrapper, 'Save').attributes('type')).toBe('button');
	});
});
