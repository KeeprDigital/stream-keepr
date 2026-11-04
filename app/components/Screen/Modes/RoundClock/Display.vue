<script setup lang="ts">
import type { RoundClockState } from '~~/shared/utils/roundClock';
import { modeTokenVar, modeTypographyStyle } from '~/modules/screen-mode';

const { config, error, ready, isEmpty, round, clock } = useRoundClockModeData(useScreenContext());

const surfaceStyle = {
	backgroundColor: modeTokenVar('round-clock', 'surface'),
};
const roundNameStyle = {
	...modeTypographyStyle('round-clock', 'round-name-typography'),
	color: modeTokenVar('round-clock', 'round-name-text'),
};

const clockColors: Record<Exclude<RoundClockState, 'untimed'>, string> = {
	pending: modeTokenVar('round-clock', 'pending-clock-text'),
	running: modeTokenVar('round-clock', 'clock-text'),
	ended: modeTokenVar('round-clock', 'ended-clock-text'),
};

const clockStyle = computed(() => ({
	...modeTypographyStyle('round-clock', 'clock-typography'),
	color: clock.value.state === 'untimed'
		? undefined
		: clockColors[clock.value.state],
}));
</script>

<template>
	<ScreenModeBase
		:error="error"
		:ready="ready"
		:empty="isEmpty"
	>
		<div class="round-clock-display" :data-clock-state="clock.state" :style="surfaceStyle">
			<div v-if="config.showRoundName" class="round-clock-name" :style="roundNameStyle">
				{{ round?.name }}
			</div>
			<!-- A Round with no duration has no clock to show, only its name. -->
			<div
				v-if="clock.display"
				class="round-clock-time"
				role="timer"
				:aria-label="`Time remaining in ${round?.name ?? 'the Round'}`"
				:style="clockStyle"
			>
				{{ clock.display }}
			</div>
		</div>
	</ScreenModeBase>
</template>

<style scoped>
.round-clock-display {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 1rem;
	padding: 2rem 4rem;
	border-radius: 1rem;
}
.round-clock-name {
	font-size: 3rem;
	line-height: 1.1;
	text-align: center;
}
.round-clock-time {
	font-size: 10rem;
	line-height: 1;
	font-variant-numeric: tabular-nums;
}
</style>
