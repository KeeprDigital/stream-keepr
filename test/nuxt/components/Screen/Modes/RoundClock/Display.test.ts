import type { ScreenOutputRoundClockRound } from '~~/shared/types/screenOutputReads';
import type { RoundClockProjection } from '~~/shared/utils/roundClock';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { computed, ref } from 'vue';
import Display from '~/components/Screen/Modes/RoundClock/Display.vue';

const config = ref({ roundId: undefined as number | undefined, showRoundName: true });
const isEmpty = ref(false);
const round = ref<ScreenOutputRoundClockRound | null>(null);
const clock = ref<RoundClockProjection>({ state: 'untimed', display: null, nextChangeInMs: null });

mockNuxtImport('useScreenContext', () => () => ({}));
mockNuxtImport('useRoundClockModeData', () => () => ({
	config: computed(() => config.value),
	error: computed(() => null),
	ready: computed(() => true),
	isEmpty: computed(() => isEmpty.value),
	round: computed(() => round.value),
	clock: computed(() => clock.value),
}));

const ROUND = {
	id: 31,
	name: 'Round 4',
	startedAt: null,
	durationMinutes: 50,
};

describe('screenModesRoundClockDisplay', () => {
	it.each([
		[
			'running',
			{ state: 'running', display: '39:59', nextChangeInMs: 1000 },
			true,
			['Round 4'],
			'39:59',
		],
		[
			'before the start',
			{ state: 'pending', display: '50:00', nextChangeInMs: null },
			true,
			['Round 4'],
			'50:00',
		],
		[
			'after the end',
			{ state: 'ended', display: '0:00', nextChangeInMs: null },
			true,
			['Round 4'],
			'0:00',
		],
		[
			'with no duration: its name and no clock',
			{ state: 'untimed', display: null, nextChangeInMs: null },
			true,
			['Round 4'],
			null,
		],
		[
			'with the Round name hidden',
			{ state: 'running', display: '12:00', nextChangeInMs: 1000 },
			false,
			[],
			'12:00',
		],
	] as const)('shows a Round %s', (_case, projection, showRoundName, names, timer) => {
		config.value = { roundId: undefined, showRoundName };
		isEmpty.value = false;
		round.value = ROUND;
		clock.value = { ...projection };

		const wrapper = mount(Display);

		expect(wrapper.find('[data-clock-state]').attributes('data-clock-state')).toBe(projection.state);
		expect(wrapper.findAll('.round-clock-name').map(name => name.text())).toEqual(names);
		const shown = wrapper.find('[role="timer"]');
		expect(shown.exists()
			? shown.text()
			: null).toBe(timer);
	});

	it('renders nothing with no Round to show', () => {
		isEmpty.value = true;
		round.value = null;

		expect(mount(Display).find('[data-clock-state]').exists()).toBe(false);
	});
});
