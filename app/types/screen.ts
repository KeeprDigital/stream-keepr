import type { ScreenCommand, ScreenMode } from '~~/shared/types/enums';

// Re-export ScreenMode for use in components
export type { ScreenMode };
export type { ScreenCommand };

// Presence data for screen clients
export interface ScreenPresenceData {
	screenId: number;
	connectedAt: number;
	userAgent?: string;
	outputMode?: 'overlay' | 'fill' | 'key';
}
