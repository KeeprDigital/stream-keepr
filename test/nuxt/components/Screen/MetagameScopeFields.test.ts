import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import { screenModeConfigContract } from '~~/shared/screenModes';
import MetagameScopeFields from '~/components/Screen/MetagameScopeFields.vue';

/**
 * The one editor of a Metagame Scope (#777), shared by every mode reading the
 * metagame: it offers the scopes its mode's contract holds, the field its
 * current scope reads, and the archetype filter where offered, and emits each
 * edit as the patch naming it.
 */

const mockPlayerListStore = {
	lists: [{ id: 7, name: 'Feature Table', memberCount: 4 }] as Array<{ id: number; name: string; memberCount: number }>,
};

mockNuxtImport('usePlayerListStore', () => () => mockPlayerListStore);

const UFormFieldStub = defineComponent({
	props: { label: { type: String, required: false } },
	template: '<div data-testid="form-field" :data-label="label"><slot /></div>',
});

const controlProps = {
	modelValue: { type: null, required: false },
	items: { type: Array, required: false },
	min: { type: Number, required: false },
	max: { type: Number, required: false },
};

const USelectStub = defineComponent({
	props: controlProps,
	emits: ['update:modelValue'],
	template: '<div data-testid="u-select">{{ (items || []).map(item => item.label).join("|") }}</div>',
});

const UInputNumberStub = defineComponent({ props: controlProps, emits: ['update:modelValue'], template: '<div data-testid="u-input-number" />' });
const UInputStub = defineComponent({ props: controlProps, emits: ['update:modelValue'], template: '<div data-testid="u-input" />' });

const metagameFields = screenModeConfigContract('metagame').fields;
const topCardsFields = screenModeConfigContract('top-cards').fields;
const spotlightFields = screenModeConfigContract('archetype-spotlight').fields;

function mountFields(props: Record<string, unknown>) {
	return mount(MetagameScopeFields, {
		props: { description: 'Which players to include.', ...props } as any,
		global: { stubs: { UFormField: UFormFieldStub, USelect: USelectStub, UInputNumber: UInputNumberStub, UInput: UInputStub } },
	});
}

const baseConfig = { scope: 'all', topN: 8, minPoints: 9, playerListId: undefined, archetypeFilter: undefined };

function field(wrapper: ReturnType<typeof mountFields>, label: string) {
	return wrapper.findAll('[data-testid="form-field"]').find(item => item.attributes('data-label') === label);
}

describe('screenMetagameScopeFields', () => {
	beforeEach(() => {
		mockPlayerListStore.lists = [{ id: 7, name: 'Feature Table', memberCount: 4 }];
	});

	it('offers every scope its contract holds', () => {
		const wrapper = mountFields({ config: baseConfig, fields: metagameFields });

		expect(field(wrapper, 'Player scope')!.text()).toBe('All Players|Top N|Minimum Points|Player List');
	});

	it('offers no Minimum Points scope to a mode whose contract holds no minimum', () => {
		const wrapper = mountFields({ config: baseConfig, fields: topCardsFields });

		expect(field(wrapper, 'Player scope')!.text()).toBe('All Players|Top N|Player List');
	});

	it('offers the Player List scope only while the Event has a list', () => {
		mockPlayerListStore.lists = [];
		const wrapper = mountFields({ config: baseConfig, fields: metagameFields });

		expect(field(wrapper, 'Player scope')!.text()).toBe('All Players|Top N|Minimum Points');
	});

	it('emits a scope edit as the patch naming it', () => {
		const wrapper = mountFields({ config: baseConfig, fields: metagameFields });
		field(wrapper, 'Player scope')!.getComponent(USelectStub).vm.$emit('update:modelValue', 'topN');

		expect(wrapper.emitted('update')).toEqual([[{ scope: 'topN' }]]);
	});

	it.each([
		['topN', 'Top N', 16, { topN: 16 }],
		['minPoints', 'Minimum points', 12, { minPoints: 12 }],
	] as const)('asks for the %s scope\'s own field, within its contract bounds', (scope, label, value, patch) => {
		const wrapper = mountFields({ config: { ...baseConfig, scope }, fields: metagameFields });
		const input = field(wrapper, label)!.getComponent(UInputNumberStub);

		expect({ min: input.props('min'), max: input.props('max') })
			.toEqual({ min: metagameFields[scope].min, max: metagameFields[scope].max });
		input.vm.$emit('update:modelValue', value);
		expect(wrapper.emitted('update')).toEqual([[patch]]);
	});

	it('asks for no scope field under the All Players scope', () => {
		const wrapper = mountFields({ config: baseConfig, fields: metagameFields });

		expect(wrapper.findAll('[data-testid="form-field"]').map(item => item.attributes('data-label')))
			.toEqual(['Player scope', 'Archetype filter']);
	});

	it('picks a Player List under its scope, and clears it as a deletion', () => {
		const wrapper = mountFields({ config: { ...baseConfig, scope: 'playerList', playerListId: 7 }, fields: spotlightFields });
		const picker = field(wrapper, 'Select list')!.getComponent(USelectStub);

		expect(picker.text()).toBe('Select a list...|Feature Table (4)');
		picker.vm.$emit('update:modelValue', 7);
		picker.vm.$emit('update:modelValue', null);
		expect(wrapper.emitted('update')).toEqual([[{ playerListId: 7 }], [{ playerListId: null }]]);
	});

	it('says there is no list to pick while the Event has none', () => {
		mockPlayerListStore.lists = [];
		const wrapper = mountFields({ config: { ...baseConfig, scope: 'playerList' }, fields: metagameFields });

		expect(field(wrapper, 'Select list')).toBeUndefined();
		expect(wrapper.text()).toContain('No player lists available');
	});

	it('edits the archetype filter where offered, and clears it as a deletion', () => {
		const wrapper = mountFields({ config: baseConfig, fields: topCardsFields });
		const filter = field(wrapper, 'Archetype filter')!.getComponent(UInputStub);

		filter.vm.$emit('update:modelValue', 'Rakdos Midrange');
		filter.vm.$emit('update:modelValue', '');
		expect(wrapper.emitted('update')).toEqual([[{ archetypeFilter: 'Rakdos Midrange' }], [{ archetypeFilter: null }]]);
	});

	it('offers no archetype filter where its mode holds none, or the editor hides it', () => {
		expect(field(mountFields({ config: baseConfig, fields: spotlightFields }), 'Archetype filter')).toBeUndefined();
		expect(field(mountFields({ config: baseConfig, fields: metagameFields, showArchetypeFilter: false }), 'Archetype filter')).toBeUndefined();
	});
});
