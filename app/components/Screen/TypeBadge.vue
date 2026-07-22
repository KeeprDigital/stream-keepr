<script setup lang="ts">
import type { DisplayType } from '~~/shared/types/enums';

defineProps<{
	displayType: DisplayType;
}>();
</script>

<template>
	<UBadge
		size="xs"
		:color="displayType === 'control' ? 'info' : 'neutral'"
		variant="subtle"
	>
		<UIcon
			:name="displayType === 'control' ? 'i-lucide-sliders-horizontal' : 'i-lucide-monitor'"
			class="size-3 mr-1"
		/>
		{{ displayType === 'control' ? 'Control' : 'Overlay' }}
	</UBadge>
</template>
