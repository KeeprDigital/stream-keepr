import antfu from '@antfu/eslint-config'
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  antfu({
    formatters: {
      markdown: 'prettier',
      svg: 'prettier',
      css: 'prettier',
    },
    rules: {
      'ts/consistent-type-definitions': ['error', 'type'],
      'vue/block-order': ['error', { order: ['script', 'template', 'style'] }],
      'vue/no-multiple-template-root': 'off',
    },
  }),
)
