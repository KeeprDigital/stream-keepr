<script setup lang="ts">
import type { ScreenModeConfigField } from '~~/shared/screenModeConfigs/fields';
import type { MetagameScope } from '~~/shared/types/enums';

/**
 * The settings fields of a Metagame Scope (#777), shared by every mode reading
 * the metagame: the scope, the field its current scope reads, and the archetype
 * filter where its mode offers one. Each control's label and bounds come from
 * the mode's contract `fields`, and a scope or filter the contract does not hold
 * is not offered. Each edit is emitted as the patch naming it, a cleared Player
 * List or filter as the `null` that deletes it (ADR-0041); the editor writes it.
 */
const props = withDefaults(defineProps<{
	config: {
		scope: MetagameScope;
		topN: number;
		minPoints?: number;
		playerListId?: number;
		archetypeFilter?: string;
	};
	/** The mode's contract field views; `minPoints` and `archetypeFilter` only where it holds them. */
	fields: {
		scope: ScreenModeConfigField;
		topN: ScreenModeConfigField;
		minPoints?: ScreenModeConfigField;
		archetypeFilter?: ScreenModeConfigField;
	};
	/** What the scope decides for this mode. */
	description: string;
	/** Whether the archetype filter applies to what the mode shows now, where it holds one. */
	showArchetypeFilter?: boolean;
}>(), { showArchetypeFilter: true });

const emit = defineEmits<{
	update: [patch: {
		scope?: MetagameScope;
		topN?: number;
		minPoints?: number;
		playerListId?: number | null;
		archetypeFilter?: string | null;
	}];
}>();

const playerListStore = usePlayerListStore();

const scopeOptions = computed(() => {
	const options = [
		{ label: 'All Players', value: 'all' },
		{ label: 'Top N', value: 'topN' },
	];

	if (props.fields.minPoints)
		options.push({ label: 'Minimum Points', value: 'minPoints' });

	if (playerListStore.lists.length > 0)
		options.push({ label: 'Player List', value: 'playerList' });

	return options;
});

const playerListOptions = computed(() => [
	{ label: 'Select a list...', value: null },
	...playerListStore.lists.map(list => ({
		label: `${list.name} (${list.memberCount})`,
		value: list.id,
	})),
]);
</script>

<template>
	<UFormField
		:label="fields.scope.label"
		:description="description"
		class="flex max-sm:flex-col justify-between items-start gap-4"
	>
		<USelect
			:model-value="config.scope"
			:items="scopeOptions"
			class="w-48"
			@update:model-value="emit('update', { scope: $event as MetagameScope })"
		/>
	</UFormField>

	<UFormField
		v-if="config.scope === 'topN'"
		:label="fields.topN.label"
		description="Include the top N players by position."
		class="flex max-sm:flex-col justify-between items-start gap-4"
	>
		<UInputNumber
			:model-value="config.topN"
			:min="fields.topN.min"
			:max="fields.topN.max"
			class="w-32"
			@update:model-value="emit('update', { topN: Number($event) })"
		/>
	</UFormField>

	<UFormField
		v-if="config.scope === 'minPoints' && fields.minPoints"
		:label="fields.minPoints.label"
		description="Include players with at least this many match points."
		class="flex max-sm:flex-col justify-between items-start gap-4"
	>
		<UInputNumber
			:model-value="config.minPoints"
			:min="fields.minPoints.min"
			:max="fields.minPoints.max"
			class="w-32"
			@update:model-value="emit('update', { minPoints: Number($event) })"
		/>
	</UFormField>

	<template v-if="config.scope === 'playerList'">
		<UFormField
			v-if="playerListStore.lists.length > 0"
			label="Select list"
			description="Include players from this list only."
			class="flex max-sm:flex-col justify-between items-start gap-4"
		>
			<USelect
				:model-value="config.playerListId ?? null"
				:items="playerListOptions"
				class="w-64"
				@update:model-value="emit('update', { playerListId: $event ?? null })"
			/>
		</UFormField>
		<div v-else class="text-sm text-muted text-center py-2">
			No player lists available. Create one on the Players page.
		</div>
	</template>

	<UFormField
		v-if="showArchetypeFilter && fields.archetypeFilter"
		:label="fields.archetypeFilter.label"
		description="Limit cards to a single archetype. Leave empty for all archetypes."
		class="flex max-sm:flex-col justify-between items-start gap-4"
	>
		<UInput
			:model-value="config.archetypeFilter ?? ''"
			placeholder="All archetypes"
			class="w-64"
			@update:model-value="emit('update', { archetypeFilter: $event || null })"
		/>
	</UFormField>
</template>
