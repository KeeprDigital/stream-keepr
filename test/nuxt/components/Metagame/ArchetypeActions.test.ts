import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { createMockUiArchetype } from '~~/test/helpers/fixtures';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import ArchetypeActions from '~/components/Metagame/ArchetypeActions.vue';

const management = {
	mergeInto: vi.fn(),
	remove: vi.fn(),
};
const managed = vi.fn((_eventId: unknown, _archetypeId: unknown) => management);
mockNuxtImport('useArchetypeManagement', () => (eventId: unknown, archetypeId: unknown) => managed(toValue(eventId as never), toValue(archetypeId as never)));
mockNuxtImport('useArchetypeStore', () => () => reactive({
	archetypes: [
		createMockUiArchetype({ id: 1, name: 'Burn' }),
		createMockUiArchetype({ id: 2, name: 'Boros Burn' }),
		createMockUiArchetype({ id: 3, name: 'Control' }),
	],
}));

function mountActions() {
	return mount(ArchetypeActions, {
		props: { eventId: 9, archetypeId: 1 },
		global: { stubs: nuxtUiStubs },
	});
}

beforeEach(() => vi.clearAllMocks());

describe('an Archetype\'s merge and delete actions', () => {
	it('offers every other Archetype of the Event to merge into, and merges into the one picked', async () => {
		const wrapper = mountActions();
		const select = wrapper.get('select[aria-label="Merge into another Archetype"]');

		expect(select.findAll('option').map(option => option.text()).filter(text => text !== 'Merge into…')).toEqual(['Boros Burn', 'Control']);
		await select.setValue(select.findAll('option').find(option => option.text() === 'Control')!.element.value);

		expect(managed).toHaveBeenCalledWith(9, 1);
		expect(management.mergeInto).toHaveBeenCalledWith(3);
	});

	it('deletes the Archetype', async () => {
		await mountActions().get('button[aria-label="Delete Archetype"]').trigger('click');

		expect(management.remove).toHaveBeenCalledOnce();
	});
});
