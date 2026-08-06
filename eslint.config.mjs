// @ts-check
import antfu from '@antfu/eslint-config';
import tsParser from '@typescript-eslint/parser';
import * as drizzle from 'eslint-plugin-drizzle';
import withNuxt from './.nuxt/eslint.config.mjs';

export default withNuxt(
	antfu({
		// A git worktree of this repository is a complete second copy of it. Left
		// unignored, `eslint .` from the repository root lints every one of them and
		// exhausts the heap — the parallel-round workflow in `docs/agents/` routinely
		// creates several, so this is reached by following the repo's own docs (#212).
		// `worker-configuration.d.ts` is emitted by `wrangler types`; anything lint
		// changes there is overwritten by the next generation (#239).
		ignores: ['**/migrations', '.claude/worktrees/**', '.worktrees/**', 'AGENTS.md', 'CLAUDE.md', 'worker-configuration.d.ts', 'app/utils/animation-effects/*.ts', 'app/utils/animation-effects/base.ts', 'app/utils/animation-effects/shaderBase.ts', 'app/utils/animation-effects/helpers.ts'],
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
