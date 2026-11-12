<script setup lang="ts">
import type { BackgroundLayer } from '~~/shared/types/screenConfig';
import { BACKGROUND_LAYER_TYPE_LABELS } from '~/utils/backgroundLayerLabels';

/**
 * A Screen's background, from whichever of its two sources paints it: its own
 * Background Layer stack, else its Theme's `background`. While the Screen
 * holds no stack the Theme's shows read-only, and "Customise for this Screen"
 * writes a copy of it as the Screen's own; while it holds one, the editor
 * shows it and "Reset to Theme" writes the empty stack. With no layer in
 * either, the editor starts the Screen's own. The owner wires `update:layers`
 * to its own configuration write, as it does the editor's.
 */
const props = defineProps<{
	layers: BackgroundLayer[];
	eventId: number;
}>();

const emit = defineEmits<{
	'update:layers': [layers: BackgroundLayer[]];
}>();

const { themeName, themeBackground } = useScreenThemeOverrides();

const holdsOwn = computed(() => props.layers.length > 0);

function opacityText(opacity: number): string {
	return `${Math.round(opacity * 100)}%`;
}

function customise() {
	emit('update:layers', structuredClone(toRaw(themeBackground.value)));
}
</script>

<template>
	<div :data-background-source="holdsOwn ? 'screen' : 'theme'" class="space-y-4">
		<template v-if="holdsOwn">
			<ScreenBackgroundLayersEditor
				:layers="layers"
				:event-id="eventId"
				@update:layers="emit('update:layers', $event)"
			/>
			<UButton
				label="Reset to Theme"
				icon="i-lucide-undo-2"
				variant="soft"
				size="sm"
				@click="emit('update:layers', [])"
			/>
		</template>

		<template v-else-if="themeBackground.length">
			<ScreenSettingsSubheading>
				From the Theme{{ themeName ? ` “${themeName}”` : '' }}
			</ScreenSettingsSubheading>
			<ScreenSettingsHint>
				Layers paint in order: the first layer is the bottom of the stack.
			</ScreenSettingsHint>
			<ol class="space-y-2">
				<li
					v-for="layer in themeBackground"
					:key="layer.id"
					data-testid="theme-background-layer"
					:data-layer-type="layer.type"
					:data-layer-enabled="String(layer.enabled)"
					class="flex items-center gap-2 rounded-md border border-default/60 px-3 py-2 text-sm"
					:class="{ 'text-muted': !layer.enabled }"
				>
					<span class="font-medium">{{ BACKGROUND_LAYER_TYPE_LABELS[layer.type] }}</span>
					<span class="grow" />
					<span v-if="!layer.enabled" class="text-xs">Off</span>
					<span class="text-xs tabular-nums">{{ opacityText(layer.opacity) }}</span>
				</li>
			</ol>
			<UButton
				label="Customise for this Screen"
				icon="i-lucide-pencil"
				variant="soft"
				size="sm"
				@click="customise"
			/>
		</template>

		<template v-else>
			<ScreenSettingsHint>
				The Theme has no background. Add a layer to give this Screen its own.
			</ScreenSettingsHint>
			<ScreenBackgroundLayersEditor
				:layers="layers"
				:event-id="eventId"
				@update:layers="emit('update:layers', $event)"
			/>
		</template>
	</div>
</template>
