<script setup lang="ts">
const props = defineProps<{
	open: boolean;
	mode: 'win' | 'undo';
	playerName?: string;
	currentGame: number;
	isMatchCompleting?: boolean;
}>();

const emit = defineEmits<{
	'update:open': [value: boolean];
	'confirm': [options: { resetLife: boolean; resetCounters: boolean }];
}>();

const resetForNextGame = ref(true);

const isWinMode = computed(() => props.mode === 'win');

const config = computed(() => ({
	win: {
		title: 'Record Game Win',
		confirmLabel: 'Record Win',
		confirmColor: 'success' as const,
	},
	undo: {
		title: 'Remove Game Win',
		confirmLabel: 'Remove Win',
		confirmColor: 'warning' as const,
	},
}[props.mode]));

const showResetCheckbox = computed(() =>
	!isWinMode.value || !props.isMatchCompleting,
);

watch(() => props.open, (isOpen) => {
	if (isOpen)
		resetForNextGame.value = isWinMode.value;
});

function handleConfirm() {
	const shouldReset = isWinMode.value
		? !props.isMatchCompleting && resetForNextGame.value
		: resetForNextGame.value;

	emit('confirm', { resetLife: shouldReset, resetCounters: shouldReset });
	emit('update:open', false);
}

useEnterToSubmit(handleConfirm, { disabled: () => !props.open });
</script>

<template>
	<UModal
		:open="open"
		:title="config.title"
		:ui="{ footer: 'justify-end' }"
		:dismissible="false"
		:close="false"
		@update:open="emit('update:open', $event)"
	>
		<template #body>
			<div class="flex flex-col gap-5">
				<p class="text-base text-muted leading-relaxed">
					<template v-if="isWinMode">
						Record a game win for
					</template>
					<template v-else>
						Remove a game win from
					</template>
					<span class="font-semibold text-default">{{ playerName || 'this player' }}</span>?
					<template v-if="isWinMode && isMatchCompleting">
						<br>
						<span class="text-warning font-medium">This will complete the match.</span>
					</template>
				</p>

				<label
					v-if="showResetCheckbox"
					class="flex items-center gap-3 p-3 -mx-1 rounded-lg cursor-pointer hover:bg-elevated transition-colors"
				>
					<UCheckbox
						v-model="resetForNextGame"
					/>
					<span class="text-sm select-none">
						{{ isWinMode ? 'Reset life totals and counters for next game' : 'Reset life totals and counters' }}
					</span>
				</label>
			</div>
		</template>

		<template #footer>
			<UButton
				color="neutral"
				variant="ghost"
				@click="emit('update:open', false)"
			>
				Cancel
			</UButton>
			<UButton
				:color="config.confirmColor"
				@click="handleConfirm"
			>
				{{ config.confirmLabel }}
			</UButton>
		</template>
	</UModal>
</template>
