<script setup lang="ts">
type BorderSide = 'borderTopVisible' | 'borderRightVisible' | 'borderBottomVisible' | 'borderLeftVisible';

const props = defineProps<{
	borderTopVisible?: boolean;
	borderRightVisible?: boolean;
	borderBottomVisible?: boolean;
	borderLeftVisible?: boolean;
}>();

const emit = defineEmits<{
	update: [side: BorderSide, value: boolean];
}>();

const sides = [
	{ key: 'borderTopVisible', label: 'Top', icon: 'i-lucide-panel-top' },
	{ key: 'borderRightVisible', label: 'Right', icon: 'i-lucide-panel-right' },
	{ key: 'borderBottomVisible', label: 'Bottom', icon: 'i-lucide-panel-bottom' },
	{ key: 'borderLeftVisible', label: 'Left', icon: 'i-lucide-panel-left' },
] satisfies Array<{ key: BorderSide; label: string; icon: string }>;

function valueFor(side: BorderSide) {
	return props[side] ?? true;
}

function toggle(side: BorderSide) {
	emit('update', side, !valueFor(side));
}
</script>

<template>
	<UFormField label="Border sides">
		<div class="inline-flex overflow-hidden rounded-md border border-default/70 bg-default/40">
			<UButton
				v-for="side in sides"
				:key="side.key"
				:aria-pressed="valueFor(side.key)"
				:title="`${side.label} border`"
				:icon="side.icon"
				size="sm"
				:color="valueFor(side.key) ? 'primary' : 'neutral'"
				:variant="valueFor(side.key) ? 'solid' : 'ghost'"
				class="rounded-none border-r border-default/60 px-3 last:border-r-0"
				@click="toggle(side.key)"
			>
				{{ side.label }}
			</UButton>
		</div>
	</UFormField>
</template>
