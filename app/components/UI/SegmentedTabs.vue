<script setup lang="ts">
interface SegmentedTabItem {
	label?: string;
	value?: string | number;
	icon?: string;
}

withDefaults(defineProps<{
	items: SegmentedTabItem[];
	size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
}>(), {
	size: 'sm',
});

const model = defineModel<string | number | undefined>({ required: true });
</script>

<template>
	<UFieldGroup :size="size" data-testid="section-tabs">
		<UButton
			v-for="(item, index) in items"
			:key="item.value ?? index"
			:icon="item.icon"
			:label="item.label"
			:color="model === item.value ? 'primary' : 'neutral'"
			:variant="model === item.value ? 'soft' : 'outline'"
			:data-testid="item.value ? `tab-${item.value}` : undefined"
			:data-active="model === item.value ? 'true' : 'false'"
			@click="() => { model = item.value }"
		/>
	</UFieldGroup>
</template>
