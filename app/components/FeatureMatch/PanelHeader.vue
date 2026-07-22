<script setup lang="ts">
import type { ClockState } from '~~/shared/types/featureMatchState';

const props = defineProps<{
	matchTitle: string;
	bestOf: number;
	currentGame: number;
	matchId: number;
	clock: ClockState | null;
	stateLoading: boolean;
	panelView: 'game' | 'setup';
	tableNumber?: number | null;
	tableNumberEnabled?: boolean;
}>();

const emit = defineEmits<{
	'update:panelView': [value: 'game' | 'setup'];
	'update:tableNumber': [value: number | null];
}>();
</script>

<template>
	<div class="panel-header">
		<!-- Left: Title + game info -->
		<div class="title">
			<div class="title-row">
				<span class="title-text">
					{{ matchTitle }}
				</span>
				<UInputNumber
					v-if="tableNumberEnabled && panelView === 'setup'"
					:model-value="tableNumber ?? undefined"
					:min="1"
					:increment="false"
					:decrement="false"
					size="xs"
					placeholder="#"
					class="table-input"
					@update:model-value="emit('update:tableNumber', $event ?? null)"
				/>
				<span v-else-if="tableNumber" class="table-badge">
					Table {{ tableNumber }}
				</span>
			</div>
			<span v-if="clock && bestOf > 1" class="game-info">
				Game {{ currentGame }} of {{ bestOf }}
			</span>
		</div>

		<!-- Center: Clock (inline) -->
		<div v-if="stateLoading" class="loading-indicator">
			<UIcon name="i-lucide-loader-2" class="size-4 text-muted animate-spin" />
		</div>
		<div v-else-if="clock" class="clock-wrapper">
			<FeatureMatchStateClock
				:match-id="matchId"
				:clock="clock"
			/>
		</div>

		<!-- Right: Mode toggle -->
		<div class="actions">
			<UFieldGroup>
				<UButton
					icon="i-lucide-swords"
					label="Play"
					:color="props.panelView === 'game' ? 'primary' : 'neutral'"
					:variant="props.panelView === 'game' ? 'subtle' : 'outline'"
					aria-label="Game mode"
					@click="emit('update:panelView', 'game')"
				/>
				<UButton
					icon="i-lucide-pencil"
					label="Edit"
					:color="props.panelView === 'setup' ? 'primary' : 'neutral'"
					:variant="props.panelView === 'setup' ? 'subtle' : 'outline'"
					aria-label="Setup mode"
					@click="emit('update:panelView', 'setup')"
				/>
			</UFieldGroup>
		</div>
	</div>
</template>

<style scoped>
.loading-indicator {
	display: flex;
	align-items: center;
}

.panel-header {
	display: grid;
	grid-template-columns: 1fr auto 1fr;
	align-items: center;
}

.title {
	display: flex;
	flex-direction: column;
	gap: 0.125rem;

	.title-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		min-height: 2rem;
	}

	.title-text {
		font-size: 0.875rem;
		font-weight: 600;
		color: white;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		letter-spacing: 0.03em;
	}

	.table-badge {
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--ui-text-muted);
		background: var(--ui-bg-elevated);
		padding: 0.125rem 0.5rem;
		border-radius: 0.375rem;
		white-space: nowrap;
	}

	.table-input {
		width: 4.5rem;
	}

	.game-info {
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--ui-color-neutral-300);
		letter-spacing: 0.02em;
	}
}

.clock-wrapper {
	flex: 1;
	display: flex;
	justify-content: center;
}

.actions {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	margin-left: auto;
}
</style>
