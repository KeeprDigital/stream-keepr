<script setup lang="ts">
import type { CardTypeBucket } from '~~/shared/utils/metagame';
import { CARD_TYPE_BUCKET_ORDER } from '~~/shared/utils/metagame';

/**
 * The card type chips of a card ranking (Most Played Cards, Archetype
 * Spotlight's top cards): one chip per card type, pressed while the ranking
 * includes it. Toggling a chip emits the excluded types with it added or
 * removed. A `locked` type stays included, whatever `excluded` holds, and its
 * chip cannot be toggled.
 */
const props = withDefaults(defineProps<{
	excluded: CardTypeBucket[];
	locked?: CardTypeBucket[];
	description: string;
	/** Each chip's test id is this prefix and its type. */
	testIdPrefix: string;
}>(), {
	locked: () => [],
});

const emit = defineEmits<{
	update: [excluded: CardTypeBucket[]];
}>();

function isLocked(bucket: CardTypeBucket): boolean {
	return props.locked.includes(bucket);
}

function isIncluded(bucket: CardTypeBucket): boolean {
	return isLocked(bucket) || !props.excluded.includes(bucket);
}

function toggle(bucket: CardTypeBucket) {
	if (isLocked(bucket))
		return;
	emit('update', isIncluded(bucket)
		? [...props.excluded, bucket]
		: props.excluded.filter(type => type !== bucket));
}

function label(bucket: CardTypeBucket): string {
	return bucket === 'Land'
		? 'Nonbasic Land'
		: bucket;
}
</script>

<template>
	<UFormField
		label="Card types"
		:description="description"
		class="flex flex-col gap-3"
	>
		<div class="flex flex-wrap gap-2">
			<UButton
				v-for="bucket in CARD_TYPE_BUCKET_ORDER"
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
	</UFormField>
</template>
