import type { VueWrapper } from '@vue/test-utils';
import type { Component } from 'vue';
import type { Event } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { createMockEvent } from '~~/test/helpers/fixtures';
import { mountUnderPageGuard } from '~~/test/helpers/mountUnderPageGuard';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import ConfigApiSettings from '~/components/Event/ConfigApiSettings.vue';
import ConfigBroadcastSettings from '~/components/Event/ConfigBroadcastSettings.vue';
import ConfigEventSettings from '~/components/Event/ConfigEventSettings.vue';
import ConfigFeatureMatchSettings from '~/components/Event/ConfigFeatureMatchSettings.vue';
import ConfigFormatSettings from '~/components/Event/ConfigFormatSettings.vue';

// The Event config cards. How a form tracks, diffs, settles and guards its edits
// is `useEventConfigForm`'s own test; here each card is wired to it once, and
// keeps its own fields, mapping and validation.

// The page guard needs these to install.
mockNuxtImport('useOverlay', () => () => ({
	create: () => ({
		open: () => ({
			result: Promise.resolve(true),
		}),
	}),
}));
mockNuxtImport('onBeforeRouteLeave', () => () => {});

const handleSubmit = vi.fn(async (_update: object): Promise<unknown> => true);
mockNuxtImport('useEventConfigSubmit', () => () => ({ handleSubmit }));

enableAutoUnmount(afterEach);

/** A database row stands in for the response: the cards read none of the columns the wire drops. */
function configEvent(overrides?: Parameters<typeof createMockEvent>[0]): Event {
	return createMockEvent(overrides) as unknown as Event;
}

// Attached, so pressing the footer's submit button submits the card's form.
const mountOptions = {
	attachTo: document.body,
	global: { stubs: nuxtUiStubs },
};

function mountCard(component: Component, event: Event = configEvent()) {
	return mount(component, {
		...mountOptions,
		props: { event },
	});
}

type Wrapper = VueWrapper<any>;

const field = (wrapper: Wrapper, name: string) => wrapper.get(`[data-field="${name}"]`);
const input = (wrapper: Wrapper, name: string) => field(wrapper, name).get('input');
const toggle = (wrapper: Wrapper, name: string) => field(wrapper, name).get('[role="switch"]');
const isOn = (wrapper: Wrapper, name: string) => toggle(wrapper, name).attributes('aria-checked') === 'true';
const select = (wrapper: Wrapper, name: string) => field(wrapper, name).get('select');
const shown = (wrapper: Wrapper, name: string) => (field(wrapper, name).get('input, select').element as HTMLInputElement).value;
const error = (wrapper: Wrapper, name: string) => field(wrapper, name).find('[data-error]');
const button = (wrapper: Wrapper, label: string) => wrapper.findAll('button').find(candidate => candidate.text() === label)!;

async function save(wrapper: Wrapper) {
	await button(wrapper, 'Save').trigger('click');
	await flushPromises();
}

/**
 * Submits the form itself: the shared `UInputNumber` stub carries native
 * min/max, so pressing Save on an out-of-range value is blocked by the browser's
 * own constraint validation before the card's validation can speak.
 */
async function submitOutOfRange(wrapper: Wrapper) {
	await wrapper.get('form').trigger('submit');
	await flushPromises();
}

function submitted() {
	const call = handleSubmit.mock.calls.at(-1);
	if (!call)
		throw new Error('The card saved nothing');
	return call[0];
}

interface CardCase {
	card: string;
	component: Component;
	edit: (wrapper: Wrapper) => Promise<unknown>;
	saved: object;
	/** A colleague's concurrent change to a field this operator leaves alone, and what the card then shows. */
	colleague?: { change: Parameters<typeof createMockEvent>[0]; shows: (wrapper: Wrapper) => unknown; expected: unknown };
}

const CARDS: CardCase[] = [
	{
		card: 'event',
		component: ConfigEventSettings,
		edit: wrapper => input(wrapper, 'name').setValue('Regional Championship 2026'),
		saved: { name: 'Regional Championship 2026' },
	},
	{
		card: 'display',
		component: ConfigApiSettings,
		edit: wrapper => toggle(wrapper, 'displayHideZeroDraws').trigger('click'),
		saved: { displayHideZeroDraws: false },
		colleague: {
			change: { displayPositionFormat: 'number' },
			shows: wrapper => shown(wrapper, 'displayPositionFormat'),
			expected: 'number',
		},
	},
	{
		card: 'broadcast',
		component: ConfigBroadcastSettings,
		edit: wrapper => input(wrapper, 'cardTimeout').setValue('30'),
		saved: { cardTimeout: 30 },
		colleague: {
			change: { numFeatureMatches: 4 },
			shows: wrapper => shown(wrapper, 'numFeatureMatches'),
			expected: '4',
		},
	},
	{
		card: 'feature match',
		component: ConfigFeatureMatchSettings,
		edit: wrapper => toggle(wrapper, 'turnTrackingEnabled').trigger('click'),
		saved: { featureMatchDefaultTurnTrackingEnabled: true },
		colleague: {
			change: { standingsEnabled: false },
			shows: wrapper => isOn(wrapper, 'standingsEnabled'),
			expected: false,
		},
	},
	{
		card: 'format',
		component: ConfigFormatSettings,
		edit: wrapper => input(wrapper, 'startingLife').setValue('40'),
		saved: { featureMatchDefaultStartingLife: 40 },
		colleague: {
			change: { featureMatchDefaultBestOf: 5 },
			shows: wrapper => shown(wrapper, 'bestOf'),
			expected: '5',
		},
	},
];

beforeEach(() => {
	handleSubmit.mockReset();
	handleSubmit.mockResolvedValue(true);
});

describe('event config cards', () => {
	it.each(CARDS)('the $card card tells its page it has unsaved changes until reset', async ({ component, edit }) => {
		const { wrapper, pageIsDirty } = mountUnderPageGuard<Wrapper>(component, {
			...mountOptions,
			props: {
				event: configEvent(),
			},
		});
		await flushPromises();
		expect(pageIsDirty()).toBe(false);

		await edit(wrapper);
		expect(pageIsDirty()).toBe(true);

		await button(wrapper, 'Reset').trigger('click');
		expect(pageIsDirty()).toBe(false);
	});

	it.each(CARDS)('the $card card saves its edit under the Event\'s own names', async ({ component, edit, saved }) => {
		const wrapper = mountCard(component);

		await edit(wrapper);
		await save(wrapper);

		expect(submitted()).toEqual(saved);
	});

	it.each(CARDS.filter(card => card.colleague))('the $card card saves only what was edited, keeping a colleague\'s change (#612)', async ({ component, edit, saved, colleague }) => {
		const wrapper = mountCard(component);

		await edit(wrapper);
		await wrapper.setProps({
			event: configEvent(colleague!.change),
		});
		await save(wrapper);

		expect(colleague!.shows(wrapper)).toBe(colleague!.expected);
		expect(submitted()).toEqual(saved);
	});
});

describe('event settings card', () => {
	it('reads clean once a save the server normalized lands', async () => {
		const event = reactive(configEvent({ name: 'Regional Championship' }));
		handleSubmit.mockImplementation(async (update: object) => {
			Object.assign(event, update, { name: 'Regional Championship 2026' });
			return true;
		});
		const { wrapper, pageIsDirty } = mountUnderPageGuard<Wrapper>(ConfigEventSettings, {
			...mountOptions,
			props: { event },
		});

		await input(wrapper, 'name').setValue('Regional Championship 2026  ');
		await save(wrapper);

		expect(shown(wrapper, 'name')).toBe('Regional Championship 2026');
		expect(button(wrapper, 'Save').attributes('disabled')).toBeDefined();
		expect(pageIsDirty()).toBe(false);
	});

	it('holds Save while the save is in flight', async () => {
		let land = () => {};
		handleSubmit.mockImplementation(() => new Promise((resolve) => {
			land = () => resolve(true);
		}));
		const wrapper = mountCard(ConfigEventSettings);

		await input(wrapper, 'name').setValue('Regional Championship 2026');
		await save(wrapper);
		expect(button(wrapper, 'Save').attributes('aria-busy')).toBe('true');

		land();
		await flushPromises();
		expect(button(wrapper, 'Save').attributes('aria-busy')).toBeUndefined();
	});

	it('refuses to save a name the operator has emptied', async () => {
		const wrapper = mountCard(ConfigEventSettings);

		await input(wrapper, 'name').setValue('   ');
		await save(wrapper);

		expect(handleSubmit).not.toHaveBeenCalled();
		expect(error(wrapper, 'name').text()).toBe('Event name is required');
	});
});

describe('display settings card', () => {
	it('shows the display settings the event already carries', () => {
		const wrapper = mountCard(ConfigApiSettings, configEvent({ displayRecordSeparator: '/', displayPositionFormat: 'number' }));

		expect(shown(wrapper, 'displayRecordSeparator')).toBe('/');
		expect(shown(wrapper, 'displayPositionFormat')).toBe('number');
		expect(isOn(wrapper, 'displayHideZeroDraws')).toBe(true);
	});

	it('offers a save only once the form has changed, and takes it back on reset', async () => {
		const wrapper = mountCard(ConfigApiSettings);
		expect(button(wrapper, 'Save').attributes('disabled')).toBeDefined();

		await toggle(wrapper, 'displayHideZeroDraws').trigger('click');
		expect(button(wrapper, 'Save').attributes('disabled')).toBeUndefined();

		await button(wrapper, 'Reset').trigger('click');
		expect(isOn(wrapper, 'displayHideZeroDraws')).toBe(true);
		expect(button(wrapper, 'Save').attributes('disabled')).toBeDefined();
	});
});

describe('broadcast settings card', () => {
	const broadcastEvent = () => configEvent({ numFeatureMatches: 2, cardTimeout: 10, featureMatchOrientation: 'horizontal' });

	it('shows the broadcast settings the event already carries', () => {
		const wrapper = mountCard(ConfigBroadcastSettings, broadcastEvent());

		expect(shown(wrapper, 'numFeatureMatches')).toBe('2');
		expect(shown(wrapper, 'cardTimeout')).toBe('10');
		expect(shown(wrapper, 'featureMatchOrientation')).toBe('horizontal');
	});

	it.each([
		[
			'a negative card timeout',
			'cardTimeout',
			'-1',
			'Card timeout must be 0 or greater',
		],
		[
			'more feature matches than the event can hold',
			'numFeatureMatches',
			'11',
			'Cannot exceed 10 feature matches',
		],
	])('refuses to save %s, and says so at the field', async (_, name, value, complaint) => {
		const wrapper = mountCard(ConfigBroadcastSettings, broadcastEvent());

		await input(wrapper, name).setValue(value);
		await submitOutOfRange(wrapper);

		expect(handleSubmit).not.toHaveBeenCalled();
		expect(error(wrapper, name).text()).toBe(complaint);
	});

	it('clears a validation complaint when the operator resets the form', async () => {
		const wrapper = mountCard(ConfigBroadcastSettings, broadcastEvent());

		await input(wrapper, 'cardTimeout').setValue('-1');
		await submitOutOfRange(wrapper);
		await button(wrapper, 'Reset').trigger('click');

		expect(error(wrapper, 'cardTimeout').exists()).toBe(false);
		expect(shown(wrapper, 'cardTimeout')).toBe('10');
	});
});

describe('feature match settings card', () => {
	it('shows the toggles the event already carries', () => {
		const wrapper = mountCard(ConfigFeatureMatchSettings, configEvent({ featureMatchDefaultTurnTrackingEnabled: true, lgsEnabled: true }));

		expect(isOn(wrapper, 'turnTrackingEnabled')).toBe(true);
		expect(isOn(wrapper, 'lgsEnabled')).toBe(true);
		expect(isOn(wrapper, 'pronounsEnabled')).toBe(true);
		expect(isOn(wrapper, 'tableNumberEnabled')).toBe(false);
	});

	it('offers the extra turns label only when the event tracks extra turns', () => {
		expect(mountCard(ConfigFeatureMatchSettings).find('[data-field="extraTurnsLabel"]').exists()).toBe(false);

		const tracking = mountCard(ConfigFeatureMatchSettings, configEvent({ featureMatchDefaultExtraTurnsEnabled: true }));
		expect(shown(tracking, 'extraTurnsLabel')).toBe('Extra Turns');
	});

	it.each([
		[
			'Feature Match Notes',
			'featureMatchNotesEnabled',
			{ featureMatchNotesEnabled: true },
		],
		[
			'an event-level toggle',
			'pronounsEnabled',
			{ pronounsEnabled: false },
		],
	])('saves %s under the event\'s own column', async (_, name, saved) => {
		const wrapper = mountCard(ConfigFeatureMatchSettings);

		await toggle(wrapper, name).trigger('click');
		await save(wrapper);

		expect(submitted()).toEqual(saved);
	});
});

describe('format settings card', () => {
	it('shows the match format the event already carries', () => {
		const wrapper = mountCard(ConfigFormatSettings, configEvent({ featureMatchDefaultClockDuration: 45 }));

		expect(shown(wrapper, 'bestOf')).toBe('3');
		expect(shown(wrapper, 'startingLife')).toBe('20');
		expect(shown(wrapper, 'clockDuration')).toBe('45');
		expect(shown(wrapper, 'clockType')).toBe('countdown');
	});

	it('offers the extra turns count only once extra turns are enabled', async () => {
		const wrapper = mountCard(ConfigFormatSettings);
		expect(wrapper.find('[data-field="extraTurns"]').exists()).toBe(false);

		await toggle(wrapper, 'extraTurnsEnabled').trigger('click');

		expect(shown(wrapper, 'extraTurns')).toBe('5');
	});

	it('offers the points system only to an MTG event, saving it beside the mapped defaults', async () => {
		expect(mountCard(ConfigFormatSettings, configEvent({ game: 'op' })).find('[data-field="pointsSystem"]').exists()).toBe(false);

		const mtg = mountCard(ConfigFormatSettings);
		await select(mtg, 'pointsSystem').setValue('7ph');
		await save(mtg);

		expect(submitted()).toEqual({ pointsSystem: '7ph' });
	});

	it('refuses to save a negative starting life, and says so at the field', async () => {
		const wrapper = mountCard(ConfigFormatSettings);

		await input(wrapper, 'startingLife').setValue('-1');
		await submitOutOfRange(wrapper);

		expect(handleSubmit).not.toHaveBeenCalled();
		expect(error(wrapper, 'startingLife').text()).toBe('Starting life must be 0 or greater');
	});
});
