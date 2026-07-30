import { describe, expect, it } from 'vitest';
import {
	BROADCAST_GRAPHICS_WORKSPACE_QUERY_KEY,
	broadcastGraphicsWorkspaceQuery,
	resolveBroadcastGraphicsWorkspace,
	resolveSelectedBroadcastGraphicId,
} from '~/modules/broadcast-graphics/workspace';

const stack = [
	{ id: 'lower-third', name: 'Lower Third', items: [] },
	{ id: 'slate', name: 'Slate', items: [] },
];

describe('broadcastGraphicsWorkspace', () => {
	it('defaults to the Live workspace when the URL selects nothing', () => {
		expect(resolveBroadcastGraphicsWorkspace(undefined)).toBe('live');
		expect(resolveBroadcastGraphicsWorkspace('')).toBe('live');
	});

	it('defaults to the Live workspace when the URL selects an unknown workspace', () => {
		expect(resolveBroadcastGraphicsWorkspace('program')).toBe('live');
		expect(resolveBroadcastGraphicsWorkspace(['edit', 'live'])).toBe('live');
	});

	it('addresses the Edit and Live workspaces from the URL', () => {
		expect(resolveBroadcastGraphicsWorkspace('edit')).toBe('edit');
		expect(resolveBroadcastGraphicsWorkspace('live')).toBe('live');
	});

	it('keeps the selected Broadcast Graphic in the URL so it survives a workspace change', () => {
		const query = broadcastGraphicsWorkspaceQuery({ workspace: 'edit', selectedGraphicId: 'slate' });

		expect(query[BROADCAST_GRAPHICS_WORKSPACE_QUERY_KEY]).toBe('edit');
		expect(resolveSelectedBroadcastGraphicId(query.graphic, stack)).toBe('slate');
	});

	it('drops the workspace selection from the URL when it is the Live default', () => {
		expect(broadcastGraphicsWorkspaceQuery({ workspace: 'live', selectedGraphicId: null })).toEqual({
			[BROADCAST_GRAPHICS_WORKSPACE_QUERY_KEY]: undefined,
			graphic: undefined,
		});
	});

	it('forgets a selected Broadcast Graphic that is no longer on the Screen stack', () => {
		expect(resolveSelectedBroadcastGraphicId('gone', stack)).toBeNull();
		expect(resolveSelectedBroadcastGraphicId(undefined, stack)).toBeNull();
		expect(resolveSelectedBroadcastGraphicId('lower-third', stack)).toBe('lower-third');
	});
});
