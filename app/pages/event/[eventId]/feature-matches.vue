<script setup lang="ts">
definePageMeta({
	title: 'Player Controls',
	layout: false,
});

const featureMatchStore = useFeatureMatchStore();
const featureMatchStateStore = useFeatureMatchStateStore();
const screenStore = useScreenStore();

useUnsavedChanges();

const { initialLoading, initialError, retry } = useEventPageLoading([
	{ isLoaded: () => featureMatchStore.isLoaded, load: id => featureMatchStore.loadFeatureMatchesByEventId(id) },
	{ isLoaded: () => screenStore.isLoaded, load: id => screenStore.loadScreensByEventId(id) },
]);
</script>

<template>
	<NuxtLayout name="default">
		<template v-if="featureMatchStore.featureMatches.length > 0 || initialLoading" #toolbar>
			<FeatureMatchClockGlobalControls v-if="featureMatchStore.featureMatches.length > 0" />
		</template>

		<UIInitialLoadError v-if="initialError" :error="initialError" @retry="retry" />

		<UAlert
			v-else-if="featureMatchStateStore.error"
			:title="featureMatchStateStore.error"
			color="error"
			class="mb-4"
			:close-button="{ onClick: () => featureMatchStateStore.error = null }"
		/>

		<FeatureMatchList
			v-if="!initialError"
			:matches="featureMatchStore.featureMatches"
			:loading="initialLoading"
		/>
	</NuxtLayout>
</template>
