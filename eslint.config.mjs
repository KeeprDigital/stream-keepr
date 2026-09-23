// @ts-check
import antfu from '@antfu/eslint-config';
import tsParser from '@typescript-eslint/parser';
import * as drizzle from 'eslint-plugin-drizzle';
import withNuxt from './.nuxt/eslint.config.mjs';

export default withNuxt(
	antfu({
		ignores: [
			'**/migrations',
			'.claude/worktrees/**',
			'.worktrees/**',
			'AGENTS.md',
			'CLAUDE.md',
			'worker-configuration.d.ts',
		],
		typescript: true,
		vue: true,
		formatters: {
			markdown: 'prettier',
			svg: 'prettier',
			css: 'prettier',
		},
		stylistic: {
			semi: true,
			indent: 'tab',
		},
	}),
	{
		files: ['{app,server,shared,test}/**/*.{ts,tsx,mts,cts}'],
		languageOptions: {
			parser: tsParser,
			parserOptions: {
				project: './tsconfig.eslint.json',
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			'ts/no-floating-promises': 'error',
		},
	},
	{
		files: ['app/**/*.vue'],
		languageOptions: {
			parserOptions: {
				extraFileExtensions: ['.vue'],
				parser: tsParser,
				project: './tsconfig.eslint.json',
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			'ts/no-floating-promises': 'error',
		},
	},
	{
		files: ['**/*.vue'],
		rules: {
			'vue/block-order': ['error', {
				order: ['script', 'template', 'style'],
			}],
			'vue/no-multiple-template-root': 'off',
			'vue/max-attributes-per-line': ['error', {
				singleline: { max: 3 },
				multiline: { max: 1 },
			}],
		},
	},
	{
		files: ['server/**/*.ts'],
		plugins: { drizzle },
		rules: { ...drizzle.configs.recommended.rules },
	},
);
