import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '~~/test/helpers/deferred';
import { createMockUiArchetype } from '~~/test/helpers/fixtures';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import ArchetypeNameField from '~/components/Metagame/ArchetypeNameField.vue';

const mockRepo = vi.hoisted(() => ({
	list: vi.fn(),
	getById: vi.fn(),
	create: vi.fn(),
	update: vi.fn(),
	remove: vi.fn(),
}));

vi.mock('~/modules/event-data/client', async importOriginal => ({
	...(await importOriginal<typeof import('~~/app/modules/event-data/client')>()),
	useEventDataResource: () => mockRepo,
}));

mockNuxtImport('useMetagameStore', () => () => ({
	applyRemoteInvalidated: vi.fn(),
	$reset: vi.fn(),
}));
mockNuxtImport('usePlayerDeckStore', () => () => ({
	applyArchetypeUpdated: vi.fn(),
	applyArchetypeDeleted: vi.fn(),
}));
mockNuxtImport('useFeatureMatchStore', () => () => ({
	loadFeatureMatchesByEventId: vi.fn(),
}));

const LAW = createMockUiArchetype({
	id: 4,
	eventId: 99,
	name: 'Trafalgar Law',
	leaderCardNumber: 'OP01-002',
});

const KID = createMockUiArchetype({
	id: 5,
	eventId: 99,
	name: 'Eustass Kid',
	leaderCardNumber: 'OP01-051',
});

async function mountField(props: { mergeable?: boolean } = {}) {
	const store = useArchetypeStore();
	store.$reset();
	mockRepo.list.mockResolvedValue([
		{ ...LAW },
		{ ...KID },
	]);
	const wrapper = mount(ArchetypeNameField, {
		props: { eventId: 99, archetypeId: LAW.id, ...props },
		global: { stubs: nuxtUiStubs },
	});
	await flushPromises();
	return { wrapper, store };
}

function nameInput(wrapper: Awaited<ReturnType<typeof mountField>>['wrapper']) {
	return wrapper.get<HTMLInputElement>('input[aria-label="Archetype name"]');
}

function renameButton(wrapper: Awaited<ReturnType<typeof mountField>>['wrapper']) {
	return wrapper.get('button[aria-label="Rename Archetype"]');
}

describe('metagame ArchetypeNameField', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('renames through the Archetype write, showing the name while the save is pending', async () => {
		const save = deferred<unknown>();
		mockRepo.update.mockReturnValue(save.promise);
		const { wrapper, store } = await mountField();

		await nameInput(wrapper).setValue('  Law Midrange ');
		await renameButton(wrapper).trigger('click');

		expect(mockRepo.update).toHaveBeenCalledWith(99, LAW.id, { name: 'Law Midrange' });
		expect(store.archetypes.find(archetype => archetype.id === LAW.id)?.name).toBe('Law Midrange');

		save.resolve({ ...LAW, name: 'Law Midrange', customised: true });
		await flushPromises();
		expect(nameInput(wrapper).element.value).toBe('Law Midrange');
	});

	it.each([
		['the name unchanged', 'Trafalgar Law'],
		['a blank name', '   '],
	] as const)('offers no rename for %s', async (_case, typed) => {
		const { wrapper } = await mountField();

		await nameInput(wrapper).setValue(typed);

		expect(renameButton(wrapper).attributes('disabled')).toBeDefined();
	});

	// An Event holds one Archetype per name, ignoring case and surrounding spaces.
	it('offers a merge into the Archetype holding the name, where Archetypes can be merged', async () => {
		const { wrapper } = await mountField({ mergeable: true });

		await nameInput(wrapper).setValue(' eustass kid ');
		const merge = wrapper.get('button[aria-label="Merge into Eustass Kid"]');
		await merge.trigger('click');

		expect(wrapper.emitted('merge')).toEqual([
			[KID.id],
		]);
		expect(mockRepo.update).not.toHaveBeenCalled();
	});

	it('offers neither a rename nor a merge for a held name, where an Archetype follows its Leader', async () => {
		const { wrapper } = await mountField();

		await nameInput(wrapper).setValue('eustass kid');

		expect(renameButton(wrapper).attributes('disabled')).toBeDefined();
		expect(wrapper.get('[data-name-taken]').text()).toContain('Eustass Kid');
	});
});
