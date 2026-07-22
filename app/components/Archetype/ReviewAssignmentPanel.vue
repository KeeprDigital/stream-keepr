<script setup lang="ts">
import type { Archetype } from '~/types';

const props = defineProps<{
	nameInput: string;
	colorsInput: string[];
	saving: boolean;
	isEditMode: boolean;
	isNameValid: boolean;
	matchesExistingArchetype: Archetype | null;
	matchingArchetypeId: number | null;
	buttonLabel: string;
	sortedArchetypes: Archetype[];
	archetypePlayerCounts: Map<number, number>;
	archetypeKeyCardMatches: Map<number, Set<string>>;
	/** Deck ID of the current entry — used to reset local search on navigation. */
	entryId?: number;
}>();

const emit = defineEmits<{
	(e: 'update:nameInput', value: string): void;
	(e: 'update:colorsInput', value: string[]): void;
	(e: 'accept'): void;
	(e: 'chipClick', archetype: Archetype): void;
}>();

// ── Local search state (purely UI, not shared with parent) ──

const archetypeSearch = ref('');

// Reset search when navigating to a new entry
watch(() => props.entryId, () => {
	archetypeSearch.value = '';
});

const filteredArchetypes = computed(() => {
	const q = archetypeSearch.value.trim().toLowerCase();
	if (!q)
		return props.sortedArchetypes;
	return props.sortedArchetypes.filter(a => a.name.toLowerCase().includes(q));
});
</script>

<template>
	<div class="flex w-full shrink-0 flex-col overflow-hidden border-t border-default xl:w-96 xl:border-l xl:border-t-0">
		<!-- Assignment card -->
		<div class="shrink-0 p-6">
			<UCard :ui="{ root: 'bg-elevated' }">
				<div class="flex flex-col gap-3">
					<h3 class="text-xs font-semibold uppercase tracking-wide text-muted">
						{{ isEditMode ? 'Edit Assignment' : 'Assign Archetype' }}
					</h3>

					<UInput
						:model-value="nameInput"
						placeholder="Archetype name..."
						class="w-full"
						:color="matchesExistingArchetype ? 'success' : 'neutral'"
						:trailing-icon="matchesExistingArchetype ? 'i-lucide-check' : undefined"
						@update:model-value="emit('update:nameInput', $event as string)"
						@keydown.enter="emit('accept')"
					/>

					<div class="flex justify-center">
						<MtgManaColorPicker
							:model-value="colorsInput"
							size="md"
							@update:model-value="emit('update:colorsInput', $event)"
						/>
					</div>

					<UButton
						color="primary"
						block
						:disabled="!isNameValid || saving"
						:loading="saving"
						@click="emit('accept')"
					>
						{{ buttonLabel }}
					</UButton>
				</div>
			</UCard>
		</div>

		<!-- Existing archetypes picker -->
		<div v-if="sortedArchetypes.length > 0" class="flex flex-col overflow-hidden flex-1 min-h-0 px-6 pb-6">
			<div class="flex items-center gap-2 mb-3 shrink-0">
				<div class="h-px flex-1 bg-default" />
				<span class="text-xs text-muted">or pick existing</span>
				<div class="h-px flex-1 bg-default" />
			</div>

			<UInput
				v-if="sortedArchetypes.length > 8"
				v-model="archetypeSearch"
				placeholder="Search..."
				icon="i-lucide-search"
				size="xs"
				class="mb-2 shrink-0"
			/>

			<div class="flex-1 overflow-y-auto divide-y divide-default">
				<button
					v-for="archetype in filteredArchetypes"
					:key="archetype.id"
					type="button"
					class="relative w-full px-2 py-2.5 rounded-md text-left transition-colors hover:bg-elevated overflow-hidden"
					:class="archetype.id === matchingArchetypeId ? 'before:absolute before:left-0 before:inset-y-0 before:w-0.5 before:bg-primary before:rounded-full' : ''"
					@click="emit('chipClick', archetype)"
				>
					<!-- Line 1: name + mana symbols + deck count -->
					<div class="flex items-center gap-2">
						<span
							class="text-sm font-medium truncate flex-1"
							:class="archetype.id === matchingArchetypeId ? 'text-primary' : ''"
						>
							{{ archetype.name }}
						</span>
						<MtgManaColorDisplay
							v-if="archetype.colors"
							:colors="archetype.colors"
							size="xs"
							class="shrink-0"
						/>
						<span class="text-xs text-muted tabular-nums shrink-0">
							{{ archetypePlayerCounts.get(archetype.id) ?? 0 }} decks
						</span>
					</div>
					<!-- Line 2: key cards with match highlighting (only when present) -->
					<div
						v-if="archetype.keyCards?.length"
						class="text-xs mt-0.5 truncate"
					>
						<template v-for="(kc, i) in archetype.keyCards" :key="kc.id ?? kc.name">
							<span :class="archetypeKeyCardMatches.get(archetype.id)?.has(kc.name) ? 'text-primary/60' : 'text-muted'">{{ kc.name }}</span><span v-if="i < archetype.keyCards.length - 1" class="text-muted">, </span>
						</template>
					</div>
				</button>

				<p v-if="archetypeSearch && filteredArchetypes.length === 0" class="text-xs text-muted py-2">
					No archetypes matching "{{ archetypeSearch }}".
				</p>
			</div>
		</div>
	</div>
</template>
