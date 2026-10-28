<script setup lang="ts">
interface SegmentedTabItem {
	label?: string;
	value?: string | number;
	icon?: string;
	/** Names an icon-only item for assistive technology. */
	ariaLabel?: string;
	/** Shown but not choosable, such as a view the current placement cannot render. */
	disabled?: boolean;
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
			:aria-label="item.ariaLabel"
			:title="item.ariaLabel"
			:color="model === item.value ? 'primary' : 'neutral'"
			:variant="model === item.value ? 'soft' : 'outline'"
			:data-testid="item.value ? `tab-${item.value}` : undefined"
			:data-active="model === item.value ? 'true' : 'false'"
			:disabled="item.disabled"
			@click="() => { model = item.value }"
		/>
	</UFieldGroup>
</template>
