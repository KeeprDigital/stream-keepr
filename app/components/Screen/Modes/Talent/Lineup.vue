<script setup lang="ts">
import { TALENT_SCREEN_MAX_LINEUP } from '~~/shared/screenModeConfigs/talent';

/**
 * A Talent Screen's lineup (#782): the Event's Talents in the order shown,
 * each moved, removed or added to, at most `TALENT_SCREEN_MAX_LINEUP`. A
 * Talent the Event no longer lists still shows, so it can be removed. Every
 * edit emits the whole lineup. A Talent is added through the shared Talent
 * picker, offering those not yet in the lineup.
 */
const props = defineProps<{
	talentIds: readonly number[];
}>();

const emit = defineEmits<{
	update: [talentIds: number[]];
}>();

const eventStore = useEventStore();
const talents = computed(() => eventStore.event?.talents ?? []);

const lineup = computed(() => props.talentIds.map(id => ({
	id,
	name: talents.value.find(talent => talent.id === id)?.name ?? 'Unknown Talent',
})));

const full = computed(() => props.talentIds.length >= TALENT_SCREEN_MAX_LINEUP);

function add(talentId: number | null | undefined) {
	if (talentId != null && !full.value)
		emit('update', [...props.talentIds, talentId]);
}

function move(index: number, offset: -1 | 1) {
	const next = [...props.talentIds];
	const target = index + offset;
	if (target < 0 || target >= next.length)
		return;
	[next[index], next[target]] = [next[target]!, next[index]!];
	emit('update', next);
}

function remove(index: number) {
	emit('update', props.talentIds.filter((_, at) => at !== index));
}
</script>

<template>
	<div class="flex flex-col gap-4">
		<ScreenSettingsField label="Lineup" description="Shown in the order listed." stacked>
			<ol v-if="lineup.length > 0" class="flex flex-col gap-2">
				<li
					v-for="(entry, index) in lineup"
					:key="entry.id"
					class="flex items-center justify-between gap-2"
				>
					<span class="text-sm truncate" data-lineup-talent>{{ entry.name }}</span>
					<span class="flex gap-1 shrink-0">
						<UButton
							icon="i-lucide-arrow-up"
							color="neutral"
							variant="ghost"
							size="sm"
							:aria-label="`Move ${entry.name} up`"
							:disabled="index === 0"
							@click="move(index, -1)"
						/>
						<UButton
							icon="i-lucide-arrow-down"
							color="neutral"
							variant="ghost"
							size="sm"
							:aria-label="`Move ${entry.name} down`"
							:disabled="index === lineup.length - 1"
							@click="move(index, 1)"
						/>
						<UButton
							icon="i-lucide-x"
							color="neutral"
							variant="ghost"
							size="sm"
							:aria-label="`Remove ${entry.name}`"
							@click="remove(index)"
						/>
					</span>
				</li>
			</ol>
			<ScreenSettingsHint v-else>
				No Talent in the lineup yet.
			</ScreenSettingsHint>
		</ScreenSettingsField>

		<ScreenSettingsHint v-if="full">
			A lineup holds at most {{ TALENT_SCREEN_MAX_LINEUP }} Talents.
		</ScreenSettingsHint>
		<ScreenTalentField
			v-else
			data-lineup-add
			label="Add to lineup"
			:model-value="null"
			:excluded="talentIds"
			@update:model-value="add($event)"
		/>
	</div>
</template>
