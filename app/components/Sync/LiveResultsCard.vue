<script setup lang="ts">
import type { MeleeLiveResultsStopReason } from '~~/shared/types/enums';

/** A quiet tick announces nothing, so the Current Round and last check are re-read on this timer while on. */
const STATUS_REFRESH_MS = 30_000;

const STOP_COPY: Record<MeleeLiveResultsStopReason, string> = {
	idle: 'Live Results stopped: no changes for 12 hours',
	auth: 'Live Results stopped: Melee.gg rejected the credentials',
};

const eventStore = useEventStore();
const meleeStore = useMeleeStore();
const { runRequest } = useRequestFeedback();

const enabled = computed(() => !!eventStore.event?.meleeLiveResultsEnabled);
const stopReason = computed(() => eventStore.event?.meleeLiveResultsStopReason ?? null);
const state = computed<'on' | 'off' | 'stopped'>(() => {
	if (enabled.value)
		return 'on';
	return stopReason.value
		? 'stopped'
		: 'off';
});
const liveResultsError = computed(() => eventStore.event?.meleeLiveResultsError ?? null);

const currentRoundLabel = computed(() => {
	const round = meleeStore.liveResultsStatus?.currentRound;
	if (!round)
		return 'None paired yet';
	return round.phaseName
		? `${round.phaseName} - ${round.name}`
		: round.name;
});

/** The later of the status read and the Event's own field: either may be the fresher. */
const lastCheckedAt = computed(() => {
	const times = [meleeStore.liveResultsStatus?.lastCheckedAt, eventStore.event?.meleeLiveResultsLastCheckedAt]
		.filter(time => time != null)
		.map(time => new Date(time).getTime());
	return times.length > 0
		? Math.max(...times)
		: null;
});
const lastCheckedAgo = useTimeAgo(() => lastCheckedAt.value ?? Date.now());

const { pause, resume } = useIntervalFn(() => meleeStore.loadLiveResultsStatus(), STATUS_REFRESH_MS, { immediate: false });

watch(enabled, (on) => {
	if (!on) {
		pause();
		return;
	}
	void meleeStore.loadLiveResultsStatus();
	resume();
}, { immediate: true });

async function handleToggle(value: boolean | 'indeterminate') {
	await runRequest(() => meleeStore.setLiveResults(value === true), {
		error: ({ message }) => ({
			title: 'Live Results Not Changed',
			description: message,
			color: 'error',
		}),
	});
}
</script>

<template>
	<UCard :data-live-results="state">
		<template #header>
			<USwitch
				:model-value="enabled"
				:loading="meleeStore.settingLiveResults"
				:disabled="meleeStore.settingLiveResults"
				label="Live Results"
				description="Check Melee.gg every minute for the Current Round's Match Results."
				@update:model-value="handleToggle"
			/>
		</template>

		<div v-if="state === 'on'" class="flex flex-col gap-3">
			<div class="flex items-start justify-between gap-4">
				<div class="text-sm text-muted">
					Current Round
				</div>
				<div class="text-sm font-medium text-right">
					{{ currentRoundLabel }}
				</div>
			</div>
			<p class="text-sm text-muted">
				{{ lastCheckedAt === null ? 'Not checked yet' : `Checked ${lastCheckedAgo}` }}
			</p>
			<UAlert
				v-if="liveResultsError"
				color="error"
				variant="subtle"
				icon="i-lucide-triangle-alert"
				title="Live Results Error"
				:description="liveResultsError"
			/>
		</div>

		<UAlert
			v-else-if="state === 'stopped' && stopReason"
			color="warning"
			variant="subtle"
			icon="i-lucide-circle-pause"
			:title="STOP_COPY[stopReason]"
		/>

		<p v-else class="text-sm text-muted">
			Off. Use Update from Melee to refresh results by hand.
		</p>
	</UCard>
</template>
