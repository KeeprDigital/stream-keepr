import type { BroadcastGraphicsRenderModelInput } from '~~/app/modules/broadcast-graphics/renderModel';
import type { BroadcastGraphicConfig, GraphicGroupItemConfig, SocialNetworkIconGraphicItemConfig, TextGraphicItemConfig } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import { resolveBroadcastGraphicsRenderModel } from '~~/app/modules/broadcast-graphics/renderModel';
import { addGraphicGroupChild, addGraphicItem } from '~~/shared/modules/graphics';

const CANVAS = { canvasWidth: 1920, canvasHeight: 1080 };

function projectedGraphic(): BroadcastGraphicConfig {
	let graphic = addGraphicItem(
		{ id: 'lower-third', name: 'Talent lower third', items: [] },
		{ kind: 'group', id: 'profile-group', ...CANVAS },
	).graphic;
	graphic = addGraphicGroupChild(graphic, {
		kind: 'text',
		groupId: 'profile-group',
		id: 'profile-text',
	}).graphic;
	graphic = addGraphicGroupChild(graphic, {
		kind: 'social-network-icon',
		groupId: 'profile-group',
		id: 'profile-icon',
	}).graphic;
	const group = graphic.items[0] as GraphicGroupItemConfig;
	(group.children[0] as TextGraphicItemConfig).text
		= '{profile.networkLabel} · {profile.handle} · {profile.profileUrl}';
	(group.children[1] as SocialNetworkIconGraphicItemConfig).network = { projectionKey: 'profile' };
	graphic.sources = [{ key: 'talent', label: 'Talent', kind: 'talent' }];
	graphic.socialProfileProjections = [{
		key: 'profile',
		label: 'Profile',
		sourceKey: 'talent',
		presentationGroupId: 'profile-group',
		dwellMs: 8_000,
		transition: 'crossfade',
		transitionDurationMs: 250,
	}];
	return graphic;
}

describe('programmatic Social Profile Projection rendering', () => {
	it('renders one correlated profile through ordinary text and icon children', () => {
		const model = resolveBroadcastGraphicsRenderModel({
			output: 'overlay',
			...CANVAS,
			graphics: [projectedGraphic()],
			onAirGraphicIds: ['lower-third'],
			socialProfileValues: {
				'lower-third': {
					profile: {
						network: 'twitch',
						networkLabel: 'Twitch',
						handle: 'example',
						profileUrl: 'https://www.twitch.tv/example',
					},
				},
			},
		} as BroadcastGraphicsRenderModelInput & { socialProfileValues: unknown });
		const group = model.graphics[0]!.items[0]!;

		expect(group.kind).toBe('group');
		expect(group.children?.[0]?.text).toBe('Twitch · example · https://www.twitch.tv/example');
		expect(group.children?.[1]?.icon?.name).toBe('i-simple-icons-twitch');
	});

	it('omits the whole Presentation Group until an atomic profile tuple is available', () => {
		const model = resolveBroadcastGraphicsRenderModel({
			output: 'overlay',
			...CANVAS,
			graphics: [projectedGraphic()],
			onAirGraphicIds: ['lower-third'],
		});

		expect(model.graphics[0]!.items).toEqual([]);
	});
});
