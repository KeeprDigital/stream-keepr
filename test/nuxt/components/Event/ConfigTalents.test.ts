import type { DropdownMenuItem } from '@nuxt/ui';
import type { Talent } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { deferred } from '~~/test/helpers/deferred';
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

const stubs = {
	...nuxtUiStubs,
	UIEmptyState: { template: '<p data-empty />' },
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
		props: { talents },
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
const editorIsOpen = (wrapper: Wrapper) => wrapper.find('[role="dialog"]').exists();

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
});
