import type { DropdownMenuItem } from '@nuxt/ui';
import type { Talent } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive } from 'vue';
import { deferred } from '~~/test/helpers/deferred';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import ConfigTalents from '~/components/Event/ConfigTalents.vue';

function talent(id: number, name: string, socialProfiles: Talent['socialProfiles'] = {}, photo: Talent['photo'] = null, role: string | null = null): Talent {
	return {
		id,
		eventId: 1,
		name,
		role,
		socialProfiles,
		photo,
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		updatedAt: new Date('2026-01-01T00:00:00.000Z'),
	};
}

const PORTRAIT = { assetId: 'asset-portrait', revisionId: 'revision-2' } as NonNullable<Talent['photo']>;
const ALICE = talent(11, 'Alice');
const BOB = talent(12, 'Bob');
const BOB_AGAIN = talent(13, 'Bob');

const eventStore = reactive({
	error: null as string | null,
	addTalent: vi.fn(),
	updateTalent: vi.fn(),
	removeTalent: vi.fn(),
});
mockNuxtImport('useEventStore', () => () => eventStore);

// Runs the request as the real one does, minus the toasts: an empty result or a throw fails.
mockNuxtImport('useRequestFeedback', () => () => ({
	runRequest: async (request: () => Promise<unknown>) => {
		try {
			return (await request()) ?? null;
		}
		catch {
			return null;
		}
	},
}));

const confirmation = { answer: true };
mockNuxtImport('useOverlay', () => () => ({
	create: () => ({
		open: () => ({
			result: Promise.resolve(confirmation.answer),
		}),
	}),
}));

/** The library picker, answering as it does: a choice or a Clear arrives as its model value. */
const PhotoPicker = defineComponent({
	name: 'GraphicsAssetFocusPicker',
	props: [
		'modelValue',
		'eventId',
		'assetKind',
		'fieldLabel',
	],
	emits: ['update:modelValue', 'select'],
	template: '<div data-photo-picker />',
});

const stubs = {
	...nuxtUiStubs,
	UIEmptyState: { template: '<p data-empty />' },
	GraphicsAssetFocusPicker: PhotoPicker,
};

enableAutoUnmount(afterEach);

beforeEach(() => {
	vi.clearAllMocks();
	confirmation.answer = true;
	eventStore.addTalent.mockImplementation(async input => ({ id: 99, ...input }));
	eventStore.updateTalent.mockImplementation(async (id, input) => ({ id, ...input }));
	eventStore.removeTalent.mockResolvedValue({ success: true });
});

function mountComponent(talents: Talent[]) {
	return mount(ConfigTalents, {
		attachTo: document.body,
		props: { talents, eventId: 1 },
		global: { stubs },
	});
}

type Wrapper = ReturnType<typeof mountComponent>;

async function chooseRowAction(wrapper: Wrapper, index: number, label: string) {
	const menus = wrapper.findAllComponents({ name: 'UDropdownMenu' });
	const items = menus[index]!.props('items') as DropdownMenuItem[];
	const action = items.find(item => item.label === label);
	if (!action)
		throw new Error(`Row ${index} offers no "${label}" action`);
	action.onSelect?.(new Event('select') as never);
	await flushPromises();
}

function button(wrapper: Wrapper, label: string) {
	return wrapper.findAll('button').filter(candidate => candidate.text() === label).at(-1)!;
}

function profileInput(wrapper: Wrapper, network: string) {
	return wrapper.get(`[data-social-network="${network}"]`);
}

const nameInput = (wrapper: Wrapper) => wrapper.get('[data-field="name"] input');
const roleInput = (wrapper: Wrapper) => wrapper.get('[data-field="role"] input');
const editorIsOpen = (wrapper: Wrapper) => wrapper.find('[role="dialog"]').exists();

async function pickPhoto(wrapper: Wrapper, photo: Talent['photo']) {
	wrapper.getComponent(PhotoPicker).vm.$emit('update:modelValue', photo ?? undefined);
	await flushPromises();
}

async function saveEditor(wrapper: Wrapper) {
	await button(wrapper, 'Save').trigger('click');
	await flushPromises();
}

describe('event config Talents', () => {
	it('offers a focused editor with a field for each Social Profile network', async () => {
		const wrapper = mountComponent([ALICE]);
		await chooseRowAction(wrapper, 0, 'Edit');

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

	it('saves a normalized edit under the Talent\'s id, then closes the editor', async () => {
		const wrapper = mountComponent([ALICE]);
		await chooseRowAction(wrapper, 0, 'Edit');

		await nameInput(wrapper).setValue(' Alicia ');
		await profileInput(wrapper, 'twitch').setValue('  @AliceLive ');
		await profileInput(wrapper, 'youtube').setValue('https://youtube.com/@AliceVideo');
		await saveEditor(wrapper);

		expect(eventStore.updateTalent).toHaveBeenCalledWith(ALICE.id, {
			name: 'Alicia',
			socialProfiles: { twitch: 'AliceLive', youtube: 'AliceVideo' },
		});
		expect(editorIsOpen(wrapper)).toBe(false);
	});

	it('creates a normalized Talent from the add editor', async () => {
		const wrapper = mountComponent([ALICE]);
		await button(wrapper, 'Add Talent').trigger('click');

		await nameInput(wrapper).setValue('Dana');
		await profileInput(wrapper, 'bluesky').setValue('https://bsky.app/profile/dana.bsky.social');
		await saveEditor(wrapper);

		expect(eventStore.addTalent).toHaveBeenCalledWith({
			name: 'Dana',
			socialProfiles: { bluesky: 'dana.bsky.social' },
		});
		expect(editorIsOpen(wrapper)).toBe(false);
	});

	it('keeps a malformed profile error on its network field and saves nothing', async () => {
		const wrapper = mountComponent([ALICE]);
		await chooseRowAction(wrapper, 0, 'Edit');

		await profileInput(wrapper, 'x').setValue('two words');
		await saveEditor(wrapper);

		expect(wrapper.get('[data-field="socialProfiles.x"] [data-error]').text()).toContain('valid X handle');
		expect(editorIsOpen(wrapper)).toBe(true);
		expect(eventStore.updateTalent).not.toHaveBeenCalled();
	});

	it('replaces the complete profile set and treats a blank field as removal', async () => {
		const wrapper = mountComponent([
			talent(11, 'Alice', { twitch: 'Old', instagram: 'Kept' }),
		]);
		await chooseRowAction(wrapper, 0, 'Edit');

		await profileInput(wrapper, 'twitch').setValue(' ');
		await profileInput(wrapper, 'x').setValue('@New');
		await saveEditor(wrapper);

		expect(eventStore.updateTalent).toHaveBeenCalledWith(11, {
			socialProfiles: { instagram: 'Kept', x: 'New' },
		});
	});

	it('sends only the fields edited in the open editor, keeping a colleague\'s change to the rest (#612)', async () => {
		const wrapper = mountComponent([
			talent(11, 'Alice', { twitch: 'Old' }),
		]);
		await chooseRowAction(wrapper, 0, 'Edit');
		await wrapper.setProps({
			talents: [
				talent(11, 'Alice', { twitch: 'New', x: 'Added' }),
			],
		});

		await nameInput(wrapper).setValue('Alicia');
		await saveEditor(wrapper);

		expect(eventStore.updateTalent).toHaveBeenCalledWith(11, { name: 'Alicia' });
	});

	it('creates again a Talent a colleague removed while its editor was open', async () => {
		const wrapper = mountComponent([ALICE]);
		await chooseRowAction(wrapper, 0, 'Edit');
		await wrapper.setProps({ talents: [] });

		await nameInput(wrapper).setValue('Alicia');
		await saveEditor(wrapper);

		expect(eventStore.addTalent).toHaveBeenCalledWith({ name: 'Alicia', socialProfiles: {} });
	});

	it('closes an unchanged editor without a request', async () => {
		const wrapper = mountComponent([ALICE]);
		await chooseRowAction(wrapper, 0, 'Edit');

		await saveEditor(wrapper);

		expect(eventStore.updateTalent).not.toHaveBeenCalled();
		expect(editorIsOpen(wrapper)).toBe(false);
	});

	it('holds Save while the save is pending, and keeps the draft open when it fails', async () => {
		const pending = deferred<null>();
		eventStore.updateTalent.mockReturnValueOnce(pending.promise);
		const wrapper = mountComponent([ALICE]);
		await chooseRowAction(wrapper, 0, 'Edit');

		await nameInput(wrapper).setValue('Alicia');
		await button(wrapper, 'Save').trigger('click');
		expect(button(wrapper, 'Save').attributes('aria-busy')).toBe('true');

		pending.resolve(null);
		await flushPromises();
		expect(button(wrapper, 'Save').attributes('aria-busy')).toBeUndefined();
		expect(editorIsOpen(wrapper)).toBe(true);
		expect((nameInput(wrapper).element as HTMLInputElement).value).toBe('Alicia');
	});

	it.each([
		[
			true,
			[BOB_AGAIN.id],
		],
		[false, []],
	])('deletes the chosen namesake by id only once confirmed (confirmed: %s)', async (answer, deleted) => {
		confirmation.answer = answer;
		const wrapper = mountComponent([BOB, BOB_AGAIN]);

		await chooseRowAction(wrapper, 1, 'Delete');

		expect(eventStore.removeTalent.mock.calls.map(([id]) => id)).toEqual(deleted);
	});

	it.each([
		['sets a trimmed role', ALICE, ' Host ', { role: 'Host' }],
		['clears a role left blank', talent(11, 'Alice', {}, null, 'Host'), '  ', { role: null }],
	])('%s', async (_case, current, role, update) => {
		const wrapper = mountComponent([current]);
		await chooseRowAction(wrapper, 0, 'Edit');

		await roleInput(wrapper).setValue(role);
		await saveEditor(wrapper);

		expect(eventStore.updateTalent).toHaveBeenCalledWith(11, update);
	});

	it('creates a Talent with a role', async () => {
		const wrapper = mountComponent([]);
		await button(wrapper, 'Add Talent').trigger('click');

		await nameInput(wrapper).setValue('Dana');
		await roleInput(wrapper).setValue('Commentator');
		await saveEditor(wrapper);

		expect(eventStore.addTalent).toHaveBeenCalledWith({ name: 'Dana', role: 'Commentator', socialProfiles: {} });
	});

	it('shows each Talent\'s role beside its name', () => {
		const wrapper = mountComponent([talent(11, 'Alice', {}, null, 'Host'), BOB]);

		expect(wrapper.findAll('[data-talent-role]').map(role => role.text())).toEqual(['Host']);
	});

	it('offers the library\'s images for this Event as the photo', async () => {
		const wrapper = mountComponent([ALICE]);
		await chooseRowAction(wrapper, 0, 'Edit');

		expect(wrapper.getComponent(PhotoPicker).props()).toMatchObject({ eventId: 1, assetKind: 'image' });
	});

	it.each([
		[
			'saves a chosen photo with the Talent',
			ALICE,
			PORTRAIT,
			{ photo: PORTRAIT },
		],
		[
			'clears the Talent\'s photo',
			talent(11, 'Alice', {}, PORTRAIT),
			null,
			{ photo: null },
		],
	])('%s', async (_case, current, photo, update) => {
		const wrapper = mountComponent([current]);
		await chooseRowAction(wrapper, 0, 'Edit');

		await pickPhoto(wrapper, photo);
		await saveEditor(wrapper);

		expect(eventStore.updateTalent).toHaveBeenCalledWith(11, update);
	});

	it('creates a Talent with a chosen photo', async () => {
		const wrapper = mountComponent([]);
		await button(wrapper, 'Add Talent').trigger('click');

		await nameInput(wrapper).setValue('Dana');
		await pickPhoto(wrapper, PORTRAIT);
		await saveEditor(wrapper);

		expect(eventStore.addTalent).toHaveBeenCalledWith({ name: 'Dana', socialProfiles: {}, photo: PORTRAIT });
	});

	it('keeps a colleague\'s photo when the editor did not change it', async () => {
		const wrapper = mountComponent([ALICE]);
		await chooseRowAction(wrapper, 0, 'Edit');
		await wrapper.setProps({
			talents: [
				talent(11, 'Alice', {}, PORTRAIT),
			],
		});

		await nameInput(wrapper).setValue('Alicia');
		await saveEditor(wrapper);

		expect(eventStore.updateTalent).toHaveBeenCalledWith(11, { name: 'Alicia' });
	});

	it('shows each Talent\'s exact photo revision as a thumbnail, and none without one', () => {
		const wrapper = mountComponent([
			talent(11, 'Alice', {}, PORTRAIT),
			BOB,
		]);

		expect(wrapper.findAll('[data-talent-photo]').map(row => [
			row.attributes('data-talent-photo'),
			row.find('img').exists()
				? row.get('img').attributes('src')
				: null,
		])).toEqual([
			['revision-2', '/api/graphics-assets/asset-portrait/revisions/revision-2/content'],
			['none', null],
		]);
	});
});
