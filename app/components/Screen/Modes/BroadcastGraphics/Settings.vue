<script setup lang="ts">
import type { Screen } from '~/types';
import { DEFAULT_BROADCAST_GRAPHICS_CANVAS_HEIGHT, DEFAULT_BROADCAST_GRAPHICS_CANVAS_WIDTH } from '~~/shared/types/screenConfig';

const props = defineProps<{
	screen: Screen;
	eventId: number;
}>();

const screenStore = useScreenStore();

const {
	screenConfig,
	saving: screenConfigSaving,
	updateScreenConfig,
} = useScreenConfigUpdate(
	() => props.eventId,
	() => props.screen.id,
);

const { saving, resetConfig } = useModeConfigUpdate(
	() => props.eventId,
	() => props.screen.id,
	'broadcast-graphics',
);

const settingsSaving = computed(() => saving.value || screenConfigSaving.value);

defineExpose({ resetConfig, saving: settingsSaving });

onMounted(async () => {
	if (!props.screen.screenConfig?.width || !props.screen.screenConfig?.height) {
		await screenStore.updateScreenConfig(props.eventId, props.screen.id, {
			width: props.screen.screenConfig?.width ?? DEFAULT_BROADCAST_GRAPHICS_CANVAS_WIDTH,
			height: props.screen.screenConfig?.height ?? DEFAULT_BROADCAST_GRAPHICS_CANVAS_HEIGHT,
		});
	}
});

const canvasWidth = computed(() => screenConfig.value.width ?? props.screen.screenConfig?.width ?? DEFAULT_BROADCAST_GRAPHICS_CANVAS_WIDTH);
const canvasHeight = computed(() => screenConfig.value.height ?? props.screen.screenConfig?.height ?? DEFAULT_BROADCAST_GRAPHICS_CANVAS_HEIGHT);

function updateCanvasDimension(field: 'width' | 'height', value: number | null | undefined) {
	updateScreenConfig({
		[field]: value ?? (field === 'width' ? DEFAULT_BROADCAST_GRAPHICS_CANVAS_WIDTH : DEFAULT_BROADCAST_GRAPHICS_CANVAS_HEIGHT),
	});
}
</script>

<template>
	<ScreenSettingsCard title="Canvas">
		<UFormField label="Canvas Size" size="sm" description="Every Broadcast Graphic is authored in this pixel canvas.">
			<UFieldGroup class="w-full">
				<UInputNumber
					:model-value="canvasWidth"
					:placeholder="String(DEFAULT_BROADCAST_GRAPHICS_CANVAS_WIDTH)"
					:min="1"
					size="sm"
					class="min-w-0 flex-1"
					aria-label="Canvas width"
					@update:model-value="updateCanvasDimension('width', $event)"
				/>
				<UInputNumber
					:model-value="canvasHeight"
					:placeholder="String(DEFAULT_BROADCAST_GRAPHICS_CANVAS_HEIGHT)"
					:min="1"
					size="sm"
					class="min-w-0 flex-1"
					aria-label="Canvas height"
					@update:model-value="updateCanvasDimension('height', $event)"
				/>
			</UFieldGroup>
		</UFormField>
	</ScreenSettingsCard>
</template>
