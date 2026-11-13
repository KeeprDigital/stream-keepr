import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { createMockEvent } from '~~/test/helpers/fixtures';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import EventConfigFormatSettings from '~/components/Event/ConfigFormatSettings.vue';

mockNuxtImport('useEventStore', () => () => ({
	updateEvent: vi.fn(),
}));

function fieldsFor(variant: 'two-player' | 'commander') {
	const wrapper = mount(EventConfigFormatSettings, {
		props: {
			event: createMockEvent({
				variant,
				featureMatchDefaultClockType: 'countdown',
				featureMatchDefaultExtraTurnsEnabled: true,
			}) as never,
		},
		global: {
			stubs: { ...nuxtUiStubs, EventConfigFormFooter: true },
		},
	});
	return wrapper.findAll('[data-field]').map(field => field.attributes('data-field'));
}

// A Commander game is a single game with no extra turns, and its Event syncs no Deck Lists to score (ADR-0087).
describe('an Event\'s Match Format settings', () => {
	const TWO_PLAYER_ONLY = [
		'pointsSystem',
		'bestOf',
		'extraTurnsEnabled',
		'extraTurns',
	];

	it('offers a Two-Player Event the points system, best-of and extra turns', () => {
		expect(fieldsFor('two-player')).toEqual(expect.arrayContaining(TWO_PLAYER_ONLY));
	});

	it('offers a Commander Event its life and clock, and none of them', () => {
		const fields = fieldsFor('commander');

		expect(fields).toEqual(expect.arrayContaining(['startingLife', 'clockType']));
		for (const field of TWO_PLAYER_ONLY)
			expect(fields).not.toContain(field);
	});
});
