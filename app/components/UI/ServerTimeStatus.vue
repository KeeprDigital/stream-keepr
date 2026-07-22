<script setup lang="ts">
const { isSynced, lastSyncedAt, serverTimeOffset } = useServerTime();

const timeAgo = useTimeAgo(
	computed(() => lastSyncedAt.value ?? Date.now()),
	{ showSecond: true, updateInterval: 1000 },
);

const statusIcon = computed(() => (isSynced.value ? 'i-lucide-clock-3' : 'i-lucide-clock-alert'));

const offsetLabel = computed(() => {
	const ms = Math.round(serverTimeOffset.value);
	const sign = ms >= 0 ? '+' : '';
	return `${sign}${ms}ms`;
});
</script>

<template>
	<UPopover
		mode="hover"
		:open-delay="300"
		:close-delay="150"
		:content="{ side: 'right', align: 'end' }"
	>
		<button
			type="button"
			class="flex items-center justify-center rounded-md p-1.5 transition-colors hover:bg-elevated"
			aria-label="Server time sync status"
		>
			<UIcon
				:name="statusIcon"
				class="size-4"
				:class="[
					isSynced ? 'text-success' : 'text-warning',
				]"
			/>
		</button>

		<template #content>
			<div class="flex flex-col gap-2 p-3 min-w-48">
				<div class="flex items-center gap-2">
					<span
						class="size-2 rounded-full shrink-0"
						:class="[
							isSynced ? 'bg-success' : 'bg-warning',
						]"
					/>
					<span class="text-sm font-medium text-highlighted">
						{{ isSynced ? 'Server Time Synced' : 'Not Synced' }}
					</span>
				</div>

				<div class="flex flex-col gap-1 text-xs text-muted">
					<template v-if="isSynced">
						<div class="flex justify-between gap-4">
							<span>Last synced</span>
							<span class="text-dimmed">{{ timeAgo }}</span>
						</div>
						<div class="flex justify-between gap-4">
							<span>Clock offset</span>
							<span class="text-dimmed">{{ offsetLabel }}</span>
						</div>
					</template>
					<template v-else>
						<p>Using local device time. Server sync will retry automatically.</p>
					</template>
				</div>
			</div>
		</template>
	</UPopover>
</template>
