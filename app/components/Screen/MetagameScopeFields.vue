<script setup lang="ts">
import type { ScreenModeConfigField } from '~~/shared/screenModeConfigs/fields';
import type { MetagameScope } from '~~/shared/types/enums';
import { getMetagameRules } from '~~/shared/config/games';
import { useConsumedEventData } from '~/modules/event-data/resync';

/**
 * The settings fields of a Metagame Scope (#777), shared by every mode reading
 * the metagame: the scope, the field its current scope reads, and the archetype
 * filter where its mode offers one. Each control's label and bounds come from
 * the mode's contract `fields`. Every mode offers every scope its Event's Card
 * Game reads (#904, ADR-0074); a filter the contract does not hold is not offered. Each edit is emitted as the patch
 * naming it, a cleared Player List or filter as the `null` that deletes it
 * (ADR-0041); the editor writes it.
 */
const props = withDefaults(defineProps<{
	config: {
		scope: MetagameScope;
		topN: number;
		minPoints: number;
		playerListId?: number;
		archetypeFilter?: string;
	};
	/** The mode's contract field views; `archetypeFilter` only where it holds one. */
	fields: {
		scope: ScreenModeConfigField;
		topN: ScreenModeConfigField;
		minPoints: ScreenModeConfigField;
		archetypeFilter?: ScreenModeConfigField;
	};
	/** What the scope decides for this mode. */
	description: string;
	/** The Event whose Player Lists decide whether the Player List scope is offered. */
	eventId: number;
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
const eventStore = useEventStore();

// The Player List scope is offered only to an Event holding a list, so the lists load with the scope, not its picker.
useConsumedEventData(['playerLists']);

onMounted(async () => {
	if (props.eventId && !playerListStore.isLoaded)
		await playerListStore.loadByEventId(props.eventId);
});

const scopeOptions = computed(() => {
	const options: { label: string; value: MetagameScope }[] = [
		{ label: 'All Players', value: 'all' },
		{ label: 'Top N', value: 'topN' },
		{ label: 'Minimum Points', value: 'minPoints' },
	];

	if (playerListStore.lists.length > 0)
		options.push({ label: 'Player List', value: 'playerList' });

	const game = eventStore.event?.game;
	return game
		? options.filter(option => getMetagameRules(game).scopes.includes(option.value))
		: options;
});
</script>

<template>
	<ScreenSettingsField
		:label="fields.scope.label"
		:description="description"
	>
		<USelect
			:model-value="config.scope"
			:items="scopeOptions"
			class="w-48"
			@update:model-value="emit('update', { scope: $event as MetagameScope })"
		/>
	</ScreenSettingsField>

	<ScreenSettingsField
		v-if="config.scope === 'topN'"
		:label="fields.topN.label"
		description="Include the top N players by position."
	>
		<ScreenSettingsNumberField
			:model-value="config.topN"
			:min="fields.topN.min"
			:max="fields.topN.max"
			@update:model-value="emit('update', { topN: Number($event) })"
		/>
	</ScreenSettingsField>

	<ScreenSettingsField
		v-if="config.scope === 'minPoints'"
		:label="fields.minPoints.label"
		description="Include players with at least this many match points."
	>
		<ScreenSettingsNumberField
			:model-value="config.minPoints"
			:min="fields.minPoints.min"
			:max="fields.minPoints.max"
			@update:model-value="emit('update', { minPoints: Number($event) })"
		/>
	</ScreenSettingsField>

	<ScreenPlayerListField
		v-if="config.scope === 'playerList'"
		:model-value="config.playerListId"
		:event-id="eventId"
		description="Include players from this list only."
		@update:model-value="emit('update', { playerListId: $event })"
	/>

	<ScreenSettingsField
		v-if="showArchetypeFilter && fields.archetypeFilter"
		:label="fields.archetypeFilter.label"
		description="Limit cards to a single archetype. Leave empty for all archetypes."
	>
		<UInput
			:model-value="config.archetypeFilter ?? ''"
			placeholder="All archetypes"
			class="w-64"
			@update:model-value="emit('update', { archetypeFilter: $event || null })"
		/>
	</ScreenSettingsField>
</template>
