import { THEME_KEY } from 'vue-echarts';

export default defineNuxtPlugin((nuxtApp) => {
	nuxtApp.vueApp.provide(THEME_KEY, useEChartsTheme());
});
