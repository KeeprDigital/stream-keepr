<script setup lang="ts">
import type { FeatureMatchNoteDiscard } from '~~/shared/api';

defineProps<{
	assignments: FeatureMatchNoteDiscard[];
}>();

const emit = defineEmits<{
	close: [confirmed: boolean];
}>();

function matchLabel(discard: FeatureMatchNoteDiscard) {
	const player1 = discard.match.player1Data?.name ?? 'TBD';
	const player2 = discard.match.player2Data?.name ?? 'TBD';
	return `Table ${discard.match.tableNumber ?? '—'} — ${player1} vs ${player2}`;
}
</script>

<template>
	<UModal
		title="Discard Feature Match Notes?"
		:close="{ onClick: () => emit('close', false) }"
		:ui="{ footer: 'justify-end' }"
	>
		<template #body>
			<div class="space-y-4">
				<p class="text-sm text-muted">
					This reassignment ends the following Assignments. Review the exact Notes that will be lost.
				</p>
				<div
					v-for="discard in assignments"
					:key="discard.assignment.id"
					class="rounded-lg border border-warning/40 bg-warning/5 p-3"
				>
					<p class="font-medium text-sm">
						{{ matchLabel(discard) }}
					</p>
					<p class="mt-2 whitespace-pre-wrap break-words text-sm text-muted">
						{{ discard.assignment.note }}
					</p>
				</div>
			</div>
		</template>

		<template #footer>
			<UButton color="neutral" variant="ghost" @click="emit('close', false)">
				Cancel
			</UButton>
			<UButton color="error" @click="emit('close', true)">
				Discard and reassign
			</UButton>
		</template>
	</UModal>
</template>
