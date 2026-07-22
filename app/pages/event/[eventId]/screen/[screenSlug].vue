<script setup lang="ts">
import { useScreenDisplaySession } from '~/modules/screen/displaySession';

definePageMeta({
	title: 'Screen',
	layout: false,
});

const session = useScreenDisplaySession();
const {
	layoutName,
	loading,
	error,
	exportError,
	showIdentify,
	showDebug,
	identifyClass,
	debugPanelClass,
	debugInfo,
} = session;

const screenSlug = computed(() => debugInfo.value.screenSlug);

provideScreenContext(session.screenContext);
</script>

<template>
	<NuxtLayout :name="layoutName">
		<!-- Identify Flash Overlay -->
		<Transition name="identify">
			<div
				v-if="showIdentify"
				class="fixed inset-0 z-50 pointer-events-none border-8 animate-pulse"
				:class="identifyClass"
			/>
		</Transition>

		<!-- Debug Overlay -->
		<div
			v-if="showDebug"
			class="fixed top-4 left-4 z-50 flex flex-col gap-1 text-sm p-4 rounded-lg font-mono"
			:class="debugPanelClass"
		>
			<div class="text-primary font-bold mb-2">
				Debug Info
			</div>
			<div>Connection ID: {{ debugInfo.connectionId }}</div>
			<div>Screen ID: {{ debugInfo.screenId }}</div>
			<div>Screen Slug: {{ debugInfo.screenSlug }}</div>
			<div>Display Type: {{ debugInfo.displayType }}</div>
			<div>Mode: {{ debugInfo.mode }}</div>
			<div>Output: {{ debugInfo.output }}</div>
			<div v-if="debugInfo.outputWarning" class="text-warning">
				{{ debugInfo.outputWarning }}
			</div>
			<div>Uptime: {{ debugInfo.uptime }}s</div>
			<div>State: {{ debugInfo.connectionState }}</div>
		</div>

		<!-- Loading State: screen outputs must stay visually blank instead of showing operator UI. -->
		<div v-if="loading" class="size-full" />

		<!-- Error State -->
		<div v-else-if="error" class="flex flex-col items-center justify-center h-full text-center">
			<UIcon name="i-lucide-alert-circle" class="h-12 w-12 text-error mb-4" />
			<h2 class="text-xl font-semibold mb-2">
				{{ error }}
			</h2>
			<p class="text-muted">
				The screen "{{ screenSlug }}" could not be found for this event.
			</p>
		</div>

		<div v-else-if="exportError" class="fixed top-4 right-4 z-50 bg-error text-white p-4 rounded-lg">
			{{ exportError }}
		</div>

		<!-- Unified Renderer: handles both overlay and control display types -->
		<ScreenRenderer v-else />
	</NuxtLayout>
</template>

<style scoped>
.identify-enter-active,
.identify-leave-active {
	transition: opacity 0.3s ease;
}

.identify-enter-from,
.identify-leave-to {
	opacity: 0;
}
</style>
