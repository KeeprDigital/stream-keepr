export default defineNuxtConfig({
  ssr: false,
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui-pro',
    '@pinia/nuxt',
    '@vueuse/nuxt',
    '@pinia/nuxt',
    '@nuxt/image',
  ],
  eslint: {
    config: {
      standalone: false,
    },
  },
  nitro: {
    experimental: {
      websocket: true,
    },
    storage: {
      local: {
        driver: 'fs',
        base: './.data/db',
      },
    },
  },
  css: ['~/assets/css/main.css'],
  devtools: {
    enabled: true,
  },
  compatibilityDate: '2024-11-01',
  future: {
    compatibilityVersion: 4,
  },
})
