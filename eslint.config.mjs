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
// Unit and Nuxt bounds are hang detectors, set once in test/helpers/loadTolerantBounds.ts
// (README § Testing). A number written on one test, hook or wait can only undercut them.
const boundedCall = 'CallExpression:matches([callee.name=/^(?:it|test|describe|beforeAll|beforeEach|afterAll|afterEach)$/], [callee.object.name=/^(?:it|test|describe)$/], [callee.callee.object.name=/^(?:it|test|describe)$/], [callee.object.name=\'vi\'][callee.property.name=/^(?:waitFor|waitUntil)$/])';
const explicitBoundMessage = 'Leave this test, hook or wait on the suite default (test/helpers/loadTolerantBounds.ts): a timeout detects a hang, it is not a budget.';
const explicitBoundSyntax = [
	{ selector: `${boundedCall} > Literal[raw=/^[\\d_]+$/]`, message: explicitBoundMessage },
	{ selector: `${boundedCall} > ObjectExpression > Property[key.name='timeout'] > Literal[raw=/^[\\d_]+$/]`, message: explicitBoundMessage },
];
// antfu's defaults, which a block setting `no-restricted-syntax` would otherwise replace.
const defaultTsSyntax = ['TSEnumDeclaration[const=true]', 'TSExportAssignment'];
const integrationIngestionBody = 'Build ingestion initiation bodies with graphicsIngestionRequest() so the duplicate-content policy defaults to create-separate.';
// ADR-0039: a rendering reads its page size from its mode data (`pageSize`), never its config field.
const pageSizeFieldMessage = 'Read the page size its Page Rotation declares (`pageSize` from the mode data), not its config field.';
const pageSizeFieldSyntax = [
	{ selector: 'MemberExpression[property.name=/^(?:pageSize|\\w+PerPage)$/]:matches([object.name=\'config\'], [object.property.name=/^(?:value|config)$/])', message: pageSizeFieldMessage },
	{ selector: 'VariableDeclarator:not([init.callee.name=/^use\\w+ModeData$/]) > ObjectPattern > Property[key.name=/^(?:pageSize|\\w+PerPage)$/]', message: pageSizeFieldMessage },
];
const sampleDatasetImport = { regex: 'screen-mode/sample(Screen|Dataset)$', message: 'The Screen Mode Sample Dataset is a Theme preview\'s alone (components/Theme).' };
// Rendering code: what a Screen Output, a Program monitor or a preview runs.
const renderingFiles = [
	'app/composables/screen/**/*.ts',
	'app/modules/screen/**/*.ts',
	'app/modules/screen-mode/**/*.ts',
	'app/components/Screen/**/*.vue',
	'app/pages/event/*/screen/**/*.vue',
];
// The rendering code the Screen Mode Sample Dataset rule above leaves alone.
const sampleDatasetFiles = ['app/modules/screen-mode/sample*.ts', 'app/composables/screen/useScreenOutputReads.ts'];
const eventChannelSeam = 'app/modules/screen/renderingChannel.ts';
const eventChannelMessage = 'A rendering of a Screen follows its Screen\'s own channel (`renderingChannel`); a preview or editor names the Event channel through `authoringEventChannel`.';
const eventChannelImport = {
	group: ['**/realtimeChannels'],
	importNames: ['eventRealtimeChannel'],
	message: eventChannelMessage,
};
// The same function as Nuxt auto-imports it from `shared/utils`.
const eventChannelGlobal = { name: 'eventRealtimeChannel', message: eventChannelMessage };
// antfu's defaults, which a block setting `no-restricted-globals` would otherwise replace.
const defaultRestrictedGlobals = [
	{ name: 'global', message: 'Use `globalThis` instead.' },
	{ name: 'self', message: 'Use `globalThis` instead.' },
];
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
		files: ['test/{unit,nuxt}/**/*.ts'],
		rules: {
			'no-restricted-syntax': [
				'error',
				...testSyntax,
				...explicitBoundSyntax,
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
		// The Screen Mode Sample Dataset never reaches a Screen Output: only a Theme preview builds its context.
		files: ['app/**/*.{ts,vue}'],
		ignores: ['app/components/Theme/**', 'app/modules/screen-mode/sample*.ts', 'app/composables/screen/useScreenOutputReads.ts'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [sampleDatasetImport],
				},
			],
		},
	},
	{
		// A Screen Mode's renderings; its settings editor writes the field through the Pagination card.
		files: ['app/components/Screen/Modes/**/*.vue'],
		ignores: ['app/components/Screen/Modes/**/*Settings.vue'],
		rules: {
			'no-restricted-syntax': [
				'error',
				...defaultTsSyntax,
				...pageSizeFieldSyntax,
			],
			'vue/no-restricted-syntax': [
				'error',
				'DebuggerStatement',
				'LabeledStatement',
				'WithStatement',
				...pageSizeFieldSyntax,
			],
		},
	},
	{
		// #914: a Screen Mode's data, and what it builds on, takes its Screen context as an argument,
		// so a settings editor sets it up against the Screen it edits. Only a rendering injects it:
		// the composables ignored here serve renderings alone.
		files: ['app/composables/screen/**/*.ts', 'app/modules/screen-mode/**/*.ts'],
		ignores: [
			'app/composables/screen/{useScreenContext,useScreenInset,useScreenGraphicThemeTokens,useScreenGraphicAssetContentUrls}.ts',
		],
		rules: {
			'no-restricted-syntax': [
				'error',
				...defaultTsSyntax,
				{ selector: 'CallExpression[callee.name=\'useScreenContext\']', message: 'Take the Screen context as an argument; only a rendering injects it (#914).' },
			],
		},
	},
	{
		// A live rendering of a Screen follows only its Screen's own channel. Rendering code names
		// the Event channel through one seam, so nothing a Screen Output runs comes to depend on it.
		files: renderingFiles,
		ignores: [eventChannelSeam, ...sampleDatasetFiles],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [eventChannelImport, sampleDatasetImport],
				},
			],
			'no-restricted-globals': ['error', ...defaultRestrictedGlobals, eventChannelGlobal],
		},
	},
	{
		// The same, for the rendering code that may read the Screen Mode Sample Dataset.
		files: sampleDatasetFiles,
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [eventChannelImport],
				},
			],
			'no-restricted-globals': ['error', ...defaultRestrictedGlobals, eventChannelGlobal],
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
