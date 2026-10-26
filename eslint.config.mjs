// @ts-check
import antfu from '@antfu/eslint-config';
import tsParser from '@typescript-eslint/parser';
import * as drizzle from 'eslint-plugin-drizzle';
import withNuxt from './.nuxt/eslint.config.mjs';

// AGENTS.md § Writing tests. Flat config lets the last matching block's
// `no-restricted-syntax` win, so blocks that narrow `test/**` repeat these.
const testSyntax = [
	{
		selector: 'CallExpression[callee.property.name=\'toContain\']:has(CallExpression[callee.property.name=\'classes\']) > Literal[value=/^-?(?:text|bg|border|p[xytrbl]?|m[xytrbl]?|w|h|min-w|max-w|min-h|max-h|flex|grid|gap|rounded|font|leading|tracking|shadow|opacity|z|inset|space-[xy]|items|justify|self|col|row|overflow)-/]',
		message: 'Assert behaviour, ARIA or data-* state, not Tailwind classes.',
	},
	{
		selector: 'ChainExpression MemberExpression[property.name=\'$emit\']',
		message: 'Find the control with a throwing finder; an optional emit passes when the control is missing.',
	},
	{
		selector: 'IfStatement[test.property.name=\'success\'] CallExpression[callee.name=\'expect\']',
		message: 'Assert unconditionally (`.parse()`, or expect `success` first).',
	},
	{
		selector: 'CallExpression[callee.object.name=\'vi\'][callee.property.name=\'mock\'] > Literal[value=/^(?:drizzle-orm|~~\\/server\\/db\\/schema)$/]',
		message: 'Run persistence on createSqliteD1Harness rather than mocking Drizzle or the schema.',
	},
];
const integrationIngestionBody = 'Build ingestion initiation bodies with graphicsIngestionRequest() so the duplicate-content policy defaults to create-separate.';
const compositorPanelSyntax = [
	{ selector: 'CallExpression[callee.name=\'emit\'][arguments.0.value=\'update:graphics\']:not(CallExpression[callee.name=\'useCompositorEditing\'] CallExpression)', message: 'Commit the stack only through useCompositorEditing.' },
	{ selector: 'Identifier[name=\'replaceBroadcastGraphic\']', message: 'Stack replacement belongs to the compositor editing module.' },
];

export default withNuxt(
	antfu({
		ignores: [
			'**/migrations',
			'.claude/worktrees/**',
			'.worktrees/**',
			'AGENTS.md',
			'CLAUDE.md',
			'**/worker-configuration.d.ts',
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
			'vue/block-order': [
				'error',
				{
					order: ['script', 'template', 'style'],
				},
			],
			'vue/no-multiple-template-root': 'off',
			'vue/max-attributes-per-line': [
				'error',
				{
					singleline: { max: 3 },
					multiline: { max: 1 },
				},
			],
		},
	},
	{
		files: ['server/**/*.ts'],
		plugins: { drizzle },
		rules: {
			...drizzle.configs.recommended.rules,
			'no-restricted-syntax': [
				'error',
				{
					selector: 'CallExpression[callee.name=\'createError\'] > ObjectExpression:has(Property[key.name=\'statusCode\'][value.value>500][value.value<600]):not(:has(Property[key.name=\'cause\']))',
					message: 'A non-500 5xx names a cause the error mapper classifies (server/utils/errors.ts).',
				},
			],
		},
	},
	{
		files: ['test/**/*.ts'],
		rules: {
			'no-restricted-syntax': ['error', ...testSyntax],
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{ regex: 'helpers/db-mock$', message: 'Run persistence on createSqliteD1Harness.' },
					],
				},
			],
		},
	},
	{
		// Forces a lost compare-and-swap, which a real database cannot be made to lose on cue.
		files: ['test/unit/server/modules/liveState.test.ts'],
		rules: { 'no-restricted-imports': 'off' },
	},
	{
		files: ['test/integration/**/*.ts'],
		rules: {
			'no-restricted-syntax': [
				'error',
				...testSyntax,
				{
					selector: 'CallExpression:not(:has(TemplateElement[value.raw=/replacement-operations/])) > ObjectExpression > Property[key.name=\'body\'] > ObjectExpression:has(> Property[key.name=\'declaredByteLength\']):not(:has(> Property[key.name=\'source\'][value.value=\'template-package\']))',
					message: integrationIngestionBody,
				},
				{
					selector: 'CallExpression:not(:has(TemplateElement[value.raw=/replacement-operations/])) > ObjectExpression > Property[key.name=\'body\'] > CallExpression[callee.object.name=\'JSON\'] > ObjectExpression:has(> Property[key.name=\'declaredByteLength\']):not(:has(> Property[key.name=\'source\'][value.value=\'template-package\']))',
					message: integrationIngestionBody,
				},
			],
		},
	},
	{
		files: ['test/integration/**/*.ts'],
		ignores: ['test/integration/client.ts'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					paths: [
						{ name: '@nuxt/test-utils/e2e', message: 'Integration suites reach the installation through test/integration/client.ts, as a signed-in operator.' },
					],
					patterns: [
						{ regex: 'helpers/db-mock$', message: 'Run persistence on createSqliteD1Harness.' },
					],
				},
			],
		},
	},
	{
		files: ['app/components/Graphics/Compositor/**/*.vue'],
		rules: {
			'no-restricted-syntax': ['error', ...compositorPanelSyntax],
			'vue/no-restricted-syntax': [
				'error',
				{
					selector: 'CallExpression[callee.name=/^\\$?emit$/][arguments.0.value=\'update:graphics\'][arguments.1.name!=\'$event\']',
					message: 'A template may only forward a child\'s update:graphics $event unchanged.',
				},
			],
		},
	},
	{
		// The panels only; StyleRef.vue reads its own writable prop.
		files: ['app/components/Graphics/Compositor/{Animation,Bindings,Inspector,SocialProfileProjections,StackTree}.vue'],
		rules: {
			'no-restricted-syntax': [
				'error',
				...compositorPanelSyntax,
				{
					selector: 'MemberExpression[object.name=\'props\'][property.name=\'writable\']',
					message: 'The Graphics Authoring Lease check belongs to the compositor editing module.',
				},
			],
		},
	},
);
