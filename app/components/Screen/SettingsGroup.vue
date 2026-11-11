<script setup lang="ts">
/**
 * One named group of controls inside a Screen settings card, split from the
 * group before it by a separator. The first group in a card draws none.
 */
defineProps<{
	title: string;
}>();

const headingId = useId();
</script>

<template>
	<section
		role="group"
		:aria-labelledby="headingId"
		class="group/settings-group flex flex-col gap-4"
	>
		<USeparator class="group-first/settings-group:hidden" />
		<ScreenSettingsSubheading :id="headingId">
			{{ title }}
		</ScreenSettingsSubheading>
		<slot />
	</section>
</template>
