import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import ReviewAssignmentPanel from '~/components/Archetype/ReviewAssignmentPanel.vue';

function mountPanel(props: Record<string, unknown> = {}) {
	return mount(ReviewAssignmentPanel, {
		props: {
			nameInput: 'Boros Burn',
			colorsInput: ['R'],
			saving: false,
			isEditMode: true,
			isNameValid: true,
			matchesExistingArchetype: null,
			matchingArchetypeId: null,
			buttonLabel: 'Rename for all 3 decks',
			canSplit: false,
			impactNote: null,
			sortedArchetypes: [],
			archetypePlayerCounts: new Map(),
			archetypeKeyCardMatches: new Map(),
			...props,
		},
		global: {
			stubs: {
				...nuxtUiStubs,
				MtgManaColorPicker: true,
				MtgManaColorDisplay: true,
			},
		},
	});
}

const button = (wrapper: ReturnType<typeof mountPanel>, label: string) => wrapper.findAll('button').find(candidate => candidate.text() === label);

describe('archetype review assignment panel', () => {
	it.each([
		[
			'the accept action',
			'Rename for all 3 decks',
			{},
			'accept',
		],
		[
			'a new Archetype for this deck, where the rename can be one instead',
			'New archetype for this deck',
			{ canSplit: true },
			'createForDeck',
		],
		[
			'clearing the assignment of a reviewed deck',
			'Clear assignment',
			{},
			'clearAssignment',
		],
	])('offers %s', async (_case, label, props, event) => {
		const wrapper = mountPanel(props);

		await button(wrapper, label)!.trigger('click');

		expect(wrapper.emitted(event)).toHaveLength(1);
	});

	it.each([
		[
			'no new Archetype for this deck where only the rename is offered',
			'New archetype for this deck',
			{ canSplit: false },
		],
		[
			'no clearing for a deck not yet reviewed',
			'Clear assignment',
			{ isEditMode: false },
		],
	])('offers %s', (_case, label, props) => {
		expect(button(mountPanel(props), label)).toBeUndefined();
	});

	it('says what else the save changes, when it changes more than this deck', () => {
		const note = 'Also updates “Control” for 3 other decks.';

		expect(mountPanel({ impactNote: note }).get('[data-impact-note]').text()).toBe(note);
		expect(mountPanel().find('[data-impact-note]').exists()).toBe(false);
	});
});
