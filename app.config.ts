export default defineAppConfig({
	ui: {
		strategy: 'merge',
		colors: {
			primary: 'cyan',
			neutral: 'slate',
			success: 'emerald',
			warning: 'amber',
			error: 'rose',
			info: 'sky',
		},
	},
	colorMode: {
		preference: 'system',
		fallback: 'dark',
	},
});
