import type { DropdownMenuItem } from '@nuxt/ui';
import type { Talent } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { mountUnderPageGuard } from '~~/test/helpers/mountUnderPageGuard';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import ConfigTalents from '~/components/Event/ConfigTalents.vue';

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
	create: () => ({
		open: () => ({
			result: Promise.resolve(true),
		}),
	}),
}));
mockNuxtImport('onBeforeRouteLeave', () => () => {});

const stubs = {
	...nuxtUiStubs,
	UIEmptyState: { template: '<p data-empty />' },
};

enableAutoUnmount(afterEach);

const mountOptions = {
	attachTo: document.body,
	global: { stubs },
};

async function mountComponent(talents: Talent[]) {
	return mount(ConfigTalents, {
		...mountOptions,
		props: { talents },
	});
}

type Wrapper = Awaited<ReturnType<typeof mountComponent>>;

async function mountUnderGuard(talents: Talent[]) {
	return mountUnderPageGuard<Wrapper>(ConfigTalents, {
		...mountOptions,
		props: { talents },
	});
}

function chooseRowAction(wrapper: Wrapper, index: number, label: string) {
	const menus = wrapper.findAllComponents({ name: 'UDropdownMenu' });
	const items = menus[index]!.props('items') as DropdownMenuItem[];
	const action = items.find(item => item.label === label);
	if (!action)
		throw new Error(`Row ${index} offers no "${label}" action`);
	action.onSelect?.(new Event('select') as never);
}

function button(wrapper: Wrapper, label: string) {
	return wrapper.findAll('button').filter(candidate => candidate.text() === label).at(-1)!;
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
	it('offers a focused editor with a field for each Social Profile network', async () => {
		const wrapper = await mountComponent([ALICE]);
		chooseRowAction(wrapper, 0, 'Edit');
		await flushPromises();

		expect(wrapper.findAll('[data-social-network]').map(input => input.attributes('data-social-network')))
			.toEqual([
				'twitch',
				'youtube',
				'x',
				'instagram',
				'tiktok',
				'bluesky',
			]);
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

		expect(submitted(wrapper)).toEqual([
			{
				id: ALICE.id,
				name: 'Alicia',
				socialProfiles: { twitch: 'AliceLive', youtube: 'AliceVideo' },
			},
		]);
	});

	it('keeps a malformed profile error on its network field and does not stage it', async () => {
		const wrapper = await mountComponent([ALICE]);
		chooseRowAction(wrapper, 0, 'Edit');
		await flushPromises();

		await profileInput(wrapper, 'x').setValue('two words');
		await finishEditor(wrapper);

		expect(wrapper.get('[data-field="socialProfiles.x"] [data-error]').text()).toContain('valid X handle');
		expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
		expect(wrapper.emitted('submit')).toBeUndefined();
	});

	it('replaces the complete profile set and treats a blank field as removal', async () => {
		const wrapper = await mountComponent([
			talent(11, 'Alice', { twitch: 'Old', instagram: 'Kept' }),
		]);
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

		expect(submitted(wrapper)).toEqual([
			{ id: BOB_AGAIN.id, name: 'Bob', socialProfiles: {} },
		]);
	});

	// The staged list follows the response, so a save keeps a colleague's additions (#612).
	it('keeps a Talent a colleague added while this operator removes another', async () => {
		const CARA = talent(14, 'Cara');
		const wrapper = await mountComponent([ALICE, BOB]);
		chooseRowAction(wrapper, 1, 'Remove');
		await wrapper.setProps({
			talents: [ALICE, BOB, CARA],
		});
		await flushPromises();
		await button(wrapper, 'Save').trigger('click');

		expect(submitted(wrapper)).toEqual([
			{ id: ALICE.id, name: 'Alice', socialProfiles: {} },
			{ id: CARA.id, name: 'Cara', socialProfiles: {} },
		]);
	});

	it('stages only the fields edited in the open editor, keeping a colleague\'s change to the rest', async () => {
		const wrapper = await mountComponent([
			talent(11, 'Alice', { twitch: 'Old' }),
		]);
		chooseRowAction(wrapper, 0, 'Edit');
		await flushPromises();
		await wrapper.setProps({
			talents: [
				talent(11, 'Alice', { twitch: 'New', x: 'Added' }),
			],
		});
		await flushPromises();

		await wrapper.get('[data-field="name"] input').setValue('Alicia');
		await finishEditor(wrapper);
		await button(wrapper, 'Save').trigger('click');

		expect(submitted(wrapper)).toEqual([
			{
				id: 11,
				name: 'Alicia',
				socialProfiles: { twitch: 'New', x: 'Added' },
			},
		]);
	});

	it('finishes an edit on its own row after a colleague removes an earlier one', async () => {
		const wrapper = await mountComponent([ALICE, BOB]);
		chooseRowAction(wrapper, 1, 'Edit');
		await flushPromises();
		await wrapper.setProps({
			talents: [BOB],
		});
		await flushPromises();

		await wrapper.get('[data-field="name"] input').setValue('Robert');
		await finishEditor(wrapper);
		await button(wrapper, 'Save').trigger('click');

		expect(submitted(wrapper)).toEqual([
			{ id: BOB.id, name: 'Robert', socialProfiles: {} },
		]);
	});

	it('stages an edit to a Talent a colleague removed while it was open, so the save re-creates them', async () => {
		const wrapper = await mountComponent([ALICE]);
		chooseRowAction(wrapper, 0, 'Edit');
		await flushPromises();
		await wrapper.setProps({ talents: [] });
		await flushPromises();

		await wrapper.get('[data-field="name"] input').setValue('Alicia');
		await finishEditor(wrapper);
		await button(wrapper, 'Save').trigger('click');

		expect(submitted(wrapper)).toEqual([
			{ id: ALICE.id, name: 'Alicia', socialProfiles: {} },
		]);
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
			{
				name: 'Dana',
				socialProfiles: { bluesky: 'dana.bsky.social' },
			},
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
		expect(wrapper.findAllComponents({ name: 'UDropdownMenu' })).toHaveLength(2);
	});
});
