export const PREVIEW_ZOOM_OPTIONS = [
	{ label: 'Fit', value: 'fit' },
	{ label: '50%', value: '0.5' },
	{ label: '100%', value: '1' },
] as const;

export type PreviewZoom = typeof PREVIEW_ZOOM_OPTIONS[number]['value'];
