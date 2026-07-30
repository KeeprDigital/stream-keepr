import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';

/**
 * The two URL-addressable workspaces of a Broadcast Graphics Screen
 * configuration page. Authoring and operating stay distinct but one navigation
 * apart, and the Screen configuration page opens on Live.
 */
export type BroadcastGraphicsWorkspace = 'live' | 'edit';

export const BROADCAST_GRAPHICS_WORKSPACES = ['live', 'edit'] as const;

export const BROADCAST_GRAPHICS_WORKSPACE_QUERY_KEY = 'workspace';
export const BROADCAST_GRAPHICS_GRAPHIC_QUERY_KEY = 'graphic';

/** Live is the default: an unreadable or unknown selection resolves to it. */
export function resolveBroadcastGraphicsWorkspace(value: unknown): BroadcastGraphicsWorkspace {
	return typeof value === 'string' && (BROADCAST_GRAPHICS_WORKSPACES as readonly string[]).includes(value)
		? value as BroadcastGraphicsWorkspace
		: 'live';
}

/**
 * The selected Broadcast Graphic lives in the URL, so moving between the Edit
 * and Live workspaces preserves it. A selection the Screen stack no longer
 * carries is forgotten rather than left dangling.
 */
export function resolveSelectedBroadcastGraphicId(
	value: unknown,
	graphics: readonly BroadcastGraphicConfig[],
): string | null {
	if (typeof value !== 'string' || value === '')
		return null;
	return graphics.some(graphic => graphic.id === value) ? value : null;
}

export interface BroadcastGraphicsWorkspaceLocation {
	workspace: BroadcastGraphicsWorkspace;
	selectedGraphicId: string | null;
}

/** The query patch that addresses one workspace location. */
export function broadcastGraphicsWorkspaceQuery(location: BroadcastGraphicsWorkspaceLocation) {
	return {
		[BROADCAST_GRAPHICS_WORKSPACE_QUERY_KEY]: location.workspace === 'live' ? undefined : location.workspace,
		[BROADCAST_GRAPHICS_GRAPHIC_QUERY_KEY]: location.selectedGraphicId ?? undefined,
	};
}
