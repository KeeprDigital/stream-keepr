import type { ClockState } from '~~/shared/types/featureMatchState';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import PanelHeader from '~/components/FeatureMatch/PanelHeader.vue';

function clock(type: ClockState['type']): ClockState {
	return {
		type,
		durationMs: 3_000_000,
		elapsedMs: 0,
		isRunning: false,
		lastStartedAt: null,
		countUpAfterCountdown: false,
	};
}

function mountHeader(clockState: ClockState) {
	return mount(PanelHeader, {
		props: {
			matchTitle: 'Alice vs Bob',
			bestOf: 3,
			currentGame: 1,
			matchId: 1,
			clock: clockState,
			stateLoading: false,
			panelView: 'game',
		},
		global: {
			stubs: {
				...nuxtUiStubs,
				FeatureMatchStateClock: { template: '<div data-testid="clock" />' },
			},
		},
	});
}

describe('feature match panel header', () => {
	it.each([
		[
			'countdown',
			{ clock: true, untimed: false },
		],
		[
			'untimed',
			{ clock: false, untimed: true },
		],
	] as const)('shows a %s match\'s clock controls only when it has a clock', (type, expected) => {
		const wrapper = mountHeader(clock(type));

		expect({
			clock: wrapper.find('[data-testid="clock"]').exists(),
			untimed: wrapper.find('[data-testid="untimed-clock"]').exists(),
		}).toEqual(expected);
	});
});
