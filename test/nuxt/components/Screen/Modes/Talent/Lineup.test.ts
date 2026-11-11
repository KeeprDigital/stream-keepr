import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { TALENT_SCREEN_MAX_LINEUP } from '~~/shared/screenModeConfigs/talent';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import Lineup from '~/components/Screen/Modes/Talent/Lineup.vue';

// A Talent Screen's lineup: the Event's Talents in the order shown, every edit the whole lineup.

enableAutoUnmount(afterEach);

const HOST = 7;
const CASTER = 8;
const ANALYST = 9;
mockNuxtImport('useEventStore', () => () => ({
	event: {
		id: 1,
		talents: [
			{ id: HOST, name: 'Host' },
			{ id: CASTER, name: 'Caster' },
			{ id: ANALYST, name: 'Analyst' },
		],
	},
}));

function mountLineup(talentIds: number[]) {
	return mount(Lineup, {
		props: { talentIds },
		global: { stubs: nuxtUiStubs },
	});
}

type Wrapper = ReturnType<typeof mountLineup>;

const lineup = (wrapper: Wrapper) => wrapper.findAll('[data-lineup-talent]').map(row => row.text());
/** The labels of the Talents the add picker offers, its placeholder aside. */
const offered = (wrapper: Wrapper) => wrapper.findAll('select[data-testid="talent-lineup-add"] option:not([hidden])').map(option => option.text());

describe('a Talent lineup', () => {
	it('adds to the end from the Talents not yet in it', async () => {
		const wrapper = mountLineup([CASTER]);

		expect(lineup(wrapper)).toEqual(['Caster']);
		expect(offered(wrapper)).toEqual(['Host', 'Analyst']);
		await wrapper.get('select[data-testid="talent-lineup-add"]').setValue(String(HOST));

		expect(wrapper.emitted('update')).toEqual([
			[
				[CASTER, HOST],
			],
		]);
	});

	it.each([
		{
			action: 'Move Caster up',
			talentIds: [CASTER, HOST, ANALYST],
		},
		{
			action: 'Move Caster down',
			talentIds: [HOST, ANALYST, CASTER],
		},
		{
			action: 'Remove Caster',
			talentIds: [HOST, ANALYST],
		},
	])('$action', async ({ action, talentIds }) => {
		const wrapper = mountLineup([HOST, CASTER, ANALYST]);

		await wrapper.get(`button[aria-label="${action}"]`).trigger('click');

		expect(wrapper.emitted('update')).toEqual([
			[talentIds],
		]);
	});

	it('names a Talent the Event no longer lists, so it can be removed', () => {
		const wrapper = mountLineup([42]);

		expect(lineup(wrapper)).toEqual(['Unknown Talent']);
		expect(wrapper.find('button[aria-label="Remove Unknown Talent"]').exists()).toBe(true);
	});

	it.each([
		{ held: TALENT_SCREEN_MAX_LINEUP - 1, adds: true },
		{ held: TALENT_SCREEN_MAX_LINEUP, adds: false },
	])('offers adding to a lineup of $held: $adds', ({ held, adds }) => {
		const wrapper = mountLineup(Array.from({ length: held }, (_, index) => 100 + index));

		expect(wrapper.find('[data-testid="talent-lineup-add"]').exists()).toBe(adds);
	});
});
