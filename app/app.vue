<script setup lang="ts">
const colorMode = useColorMode();

const color = computed(() => colorMode.value === 'dark' ? '#111827' : 'white');

useHead({
	title: 'Stream Keepr - Event Management',
	meta: [
		{ charset: 'utf-8' },
		{ name: 'viewport', content: 'width=device-width, initial-scale=1' },
		{ key: 'theme-color', name: 'theme-color', content: color },
		{ name: 'description', content: 'Manage your tournament events and streaming overlays' },
	],
	link: [
		{ rel: 'icon', href: '/favicon.ico' },
	],
	htmlAttrs: {
		lang: 'en',
	},
});
</script>

<template>
	<UApp :toaster="{ position: 'bottom-left' }">
		<NuxtLayout>
			<NuxtPage />
		</NuxtLayout>
	</UApp>
</template>
