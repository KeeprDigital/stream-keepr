import type { ScreenOutput } from '~~/shared/types/screenConfig';

/** The graphics Screen Outputs an editor names, previews and hands out, in that order. */
export const GRAPHICS_OUTPUT_OPTIONS = [
	{ label: 'Overlay', value: 'overlay', icon: 'i-lucide-layers' },
	{ label: 'Fill', value: 'fill', icon: 'i-lucide-square' },
	{ label: 'Key', value: 'key', icon: 'i-lucide-contrast' },
] as const satisfies ReadonlyArray<{ label: string; value: ScreenOutput; icon: string }>;

export const PREVIEW_ZOOM_OPTIONS = [
	{ label: 'Fit', value: 'fit' },
	{ label: '50%', value: '0.5' },
	{ label: '100%', value: '1' },
] as const;

export type PreviewZoom = typeof PREVIEW_ZOOM_OPTIONS[number]['value'];
