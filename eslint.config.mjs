import antfu from '@antfu/eslint-config'
import drizzle from 'eslint-plugin-drizzle'
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  antfu({
    plugins: {
      drizzle,
    },
    extends: ['plugin:drizzle/recommended'],
    formatters: {
      markdown: 'prettier',
      svg: 'prettier',
      css: 'prettier',
    },
    rules: {
      'ts/consistent-type-definitions': ['error', 'type'],
      'vue/block-order': ['error', { order: ['script', 'template', 'style'] }],
    },
  }),
)
