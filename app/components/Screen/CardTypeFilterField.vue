<script setup lang="ts">
import type { Game } from '~~/shared/types/enums';
import type { MetagameCardTypeBucket } from '~~/shared/utils/metagame';
import { getMetagameCardTypeBuckets } from '~~/shared/utils/metagame';

/**
 * The card type chips of a card ranking (Most Played Cards, Archetype
 * Spotlight's top cards): one chip per card type its Event's Card Game counts
 * (ADR-0074), pressed while the ranking
 * includes it. Toggling a chip emits the excluded types with it added or
 * removed. A `locked` type stays included, whatever `excluded` holds, and its
 * chip cannot be toggled.
 */
const props = withDefaults(defineProps<{
	excluded: MetagameCardTypeBucket[];
	locked?: MetagameCardTypeBucket[];
	/** The Event's Card Game, whose card types the chips name. */
	game?: Game;
	description: string;
	/** Each chip's test id is this prefix and its type. */
	testIdPrefix: string;
}>(), {
	locked: () => [],
});

const emit = defineEmits<{
	update: [excluded: MetagameCardTypeBucket[]];
}>();

const buckets = computed(() => getMetagameCardTypeBuckets(props.game));

function isLocked(bucket: MetagameCardTypeBucket): boolean {
	return props.locked.includes(bucket);
}

function isIncluded(bucket: MetagameCardTypeBucket): boolean {
	return isLocked(bucket) || !props.excluded.includes(bucket);
}

function toggle(bucket: MetagameCardTypeBucket) {
	if (isLocked(bucket))
		return;
	emit('update', isIncluded(bucket)
		? [...props.excluded, bucket]
		: props.excluded.filter(type => type !== bucket));
}

function label(bucket: MetagameCardTypeBucket): string {
	return bucket === 'Land'
		? 'Nonbasic Land'
		: bucket;
}
</script>

<template>
	<ScreenSettingsField
		stacked
		label="Card types"
		:description="description"
		class="flex flex-col gap-3"
	>
		<div class="flex flex-wrap gap-2">
			<UButton
				v-for="bucket in buckets"
				:key="bucket"
				:label="label(bucket)"
				:variant="isIncluded(bucket) ? 'solid' : 'outline'"
				:color="isIncluded(bucket) ? 'primary' : 'neutral'"
				size="xs"
				:aria-pressed="isIncluded(bucket)"
				:disabled="isLocked(bucket)"
				:data-testid="`${testIdPrefix}-${bucket}`"
				@click="toggle(bucket)"
			/>
		</div>
	</ScreenSettingsField>
</template>
