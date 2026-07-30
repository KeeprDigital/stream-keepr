<script setup lang="ts">
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { Screen } from '~/types';
import { screenOutputPath } from '~~/shared/utils/screenOutput';

/**
 * The Live workspace of a Broadcast Graphics Screen, and the workspace the
 * Screen configuration page opens on.
 *
 * Its Program monitor is the authoritative Overlay Output itself, not a preview,
 * so it carries no editor guides. Playout actions and generated Live Control
 * per placed Broadcast Graphic arrive with the playout and input work; until
 * then no Broadcast Graphic is on air and program is empty.
 */
const props = defineProps<{
	eventId: number;
	screen: Screen;
	graphics: readonly BroadcastGraphicConfig[];
	selectedGraphicId: string | null;
	canvasWidth: number;
	canvasHeight: number;
}>();

const emit = defineEmits<{ select: [graphicId: string] }>();

const programUrl = computed(() => screenOutputPath({
	eventId: props.eventId,
	screenSlug: props.screen.slug,
	output: 'overlay',
	fitToViewport: true,
}));
const programAspectStyle = computed(() => ({
	aspectRatio: `${props.canvasWidth} / ${props.canvasHeight}`,
	maxHeight: '46vh',
}));
</script>

<template>
	<div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(19rem,24rem)]">
		<ScreenSettingsCard title="Program" :default-open="true">
			<div class="transparent-checkerboard-backdrop overflow-hidden rounded-md">
				<div class="relative mx-auto w-full" :style="programAspectStyle">
					<iframe
						:src="programUrl"
						class="absolute inset-0 size-full border-0"
						title="Broadcast Graphics program monitor"
						data-testid="program-monitor"
					/>
				</div>
			</div>
		</ScreenSettingsCard>

		<ScreenSettingsCard title="On air" :default-open="true">
			<UIEmptyState
				v-if="graphics.length === 0"
				icon="i-lucide-layers"
				title="No Broadcast Graphics"
				description="Compose a Broadcast Graphic in the Edit workspace."
			/>
			<div v-else class="space-y-1.5">
				<button
					v-for="graphic in graphics"
					:key="graphic.id"
					type="button"
					class="flex w-full items-start gap-3 rounded-lg border p-3 text-left transition"
					:class="selectedGraphicId === graphic.id ? 'border-primary bg-primary/10' : 'border-default/70 bg-muted/20 hover:bg-muted/40'"
					data-testid="live-stack-entry"
					@click="emit('select', graphic.id)"
				>
					<UIcon name="i-lucide-layers" class="mt-0.5 size-4 shrink-0 text-muted" />
					<span class="min-w-0 flex-1">
						<span class="block truncate text-sm font-medium">{{ graphic.name }}</span>
						<span class="mt-0.5 block truncate text-xs text-muted">{{ graphic.items.length }} items</span>
					</span>
					<UBadge size="xs" variant="soft" class="shrink-0">
						Off
					</UBadge>
				</button>
			</div>
		</ScreenSettingsCard>
	</div>
</template>
