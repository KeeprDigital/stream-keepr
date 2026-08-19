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

	it('renders the synchronized transition as correlated Presentation Group layers clipped to its boundary', () => {
		const model = resolveBroadcastGraphicsRenderModel({
			output: 'overlay',
			...CANVAS,
			graphics: [projectedGraphic()],
			onAirGraphicIds: ['lower-third'],
			socialProfilePresentations: {
				'lower-third': {
					profile: {
						phase: { kind: 'transition', elapsedMs: 125, durationMs: 250 },
						layers: [
							{
								values: {
									network: 'twitch',
									networkLabel: 'Twitch',
									handle: 'alpha',
									profileUrl: 'https://www.twitch.tv/alpha',
								},
								opacity: 1,
								offsetX: -50,
								offsetY: 0,
							},
							{
								values: {
									network: 'youtube',
									networkLabel: 'YouTube',
									handle: 'bravo',
									profileUrl: 'https://www.youtube.com/@bravo',
								},
								opacity: 1,
								offsetX: 50,
								offsetY: 0,
							},
						],
					},
				},
			},
		} as BroadcastGraphicsRenderModelInput & { socialProfilePresentations: unknown });
		const group = model.graphics[0]!.items[0]! as typeof model.graphics[0]['items'][0] & {
			presentationLayers?: typeof model.graphics[0]['items'];
		};

		expect(group.style).toMatchObject({ overflow: 'hidden' });
		expect(group.presentationLayers?.map(layer => ({
			style: layer.style,
			text: layer.children?.[0]?.text,
			icon: layer.children?.[1]?.icon?.name,
		}))).toEqual([
			{
				style: expect.objectContaining({ opacity: 1, transform: 'translate(-50%, 0%)' }),
				text: 'Twitch · alpha · https://www.twitch.tv/alpha',
				icon: 'i-simple-icons-twitch',
			},
			{
				style: expect.objectContaining({ opacity: 1, transform: 'translate(50%, 0%)' }),
				text: 'YouTube · bravo · https://www.youtube.com/@bravo',
				icon: 'i-simple-icons-youtube',
			},
		]);
	});

	it('preserves an interrupted layered presentation beneath explicit Update Graphic', () => {
		const social = projectedGraphic();
		(social.items[0] as GraphicGroupItemConfig).animation = {
			update: { duration: 250, easing: 'linear', delay: 0, fade: { opacity: 0 } },
		};
		const outgoing = {
			network: 'twitch' as const,
			networkLabel: 'Twitch',
			handle: 'alpha',
			profileUrl: 'https://www.twitch.tv/alpha',
		};
		const current = {
			network: 'youtube' as const,
			networkLabel: 'YouTube',
			handle: 'bravo',
			profileUrl: 'https://www.youtube.com/@bravo',
		};
		const model = resolveBroadcastGraphicsRenderModel({
			output: 'overlay',
			...CANVAS,
			graphics: [social],
			onAirGraphicIds: ['lower-third'],
			animation: { 'lower-third': [{ phase: 'update', elapsed: 125 }] },
			socialProfileValues: { 'lower-third': { profile: current } },
			outgoingSocialProfileValues: { 'lower-third': { profile: current } },
			socialProfilePresentations: {
				'lower-third': {
					profile: {
						phase: { kind: 'static', elapsedMs: 0, durationMs: null },
						layers: [{ values: current, opacity: 1, offsetX: 0, offsetY: 0 }],
					},
				},
			},
			outgoingSocialProfilePresentations: {
				'lower-third': {
					profile: {
						phase: { kind: 'static', elapsedMs: 0, durationMs: null },
						layers: [
							{ values: outgoing, opacity: 0.5, offsetX: 0, offsetY: 0 },
							{ values: current, opacity: 0.5, offsetX: 0, offsetY: 0 },
						],
					},
				},
			},
		});
		const transition = model.graphics[0]!.items[0]!.crossTransition!;

		expect(transition.outgoing.presentationLayers?.map(layer => layer.children?.[0]?.text)).toEqual([
			'Twitch · alpha · https://www.twitch.tv/alpha',
			'YouTube · bravo · https://www.youtube.com/@bravo',
		]);
		expect(transition.incoming.presentationLayers?.[0]?.children?.[0]?.text)
			.toBe('YouTube · bravo · https://www.youtube.com/@bravo');
	});

	it('uses the update recipe to cross the outgoing and incoming correlated Social Profile values', () => {
		const social = projectedGraphic();
		(social.items[0] as GraphicGroupItemConfig).animation = {
			update: { duration: 250, easing: 'linear', delay: 0, fade: { opacity: 0 } },
		};
		const outgoing = { network: 'twitch' as const, networkLabel: 'Twitch', handle: 'alpha', profileUrl: 'https://www.twitch.tv/alpha' };
		const incoming = { network: 'youtube' as const, networkLabel: 'YouTube', handle: 'bravo', profileUrl: 'https://www.youtube.com/@bravo' };
		const model = resolveBroadcastGraphicsRenderModel({
			output: 'overlay',
			...CANVAS,
			graphics: [social],
			onAirGraphicIds: ['lower-third'],
			animation: { 'lower-third': [{ phase: 'update', elapsed: 125 }] },
			socialProfileValues: { 'lower-third': { profile: incoming } },
			outgoingSocialProfileValues: { 'lower-third': { profile: outgoing } },
		});
		const transition = model.graphics[0]!.items[0]!.crossTransition!;

		expect(transition.outgoing.children?.[0]?.text).toBe('Twitch · alpha · https://www.twitch.tv/alpha');
		expect(transition.outgoing.children?.[1]?.icon?.name).toBe('i-simple-icons-twitch');
		expect(transition.incoming.children?.[0]?.text).toBe('YouTube · bravo · https://www.youtube.com/@bravo');
		expect(transition.incoming.children?.[1]?.icon?.name).toBe('i-simple-icons-youtube');
	});

	it('uses the update recipe to animate an available Presentation Group to transparency', () => {
		const social = projectedGraphic();
		(social.items[0] as GraphicGroupItemConfig).animation = {
			update: { duration: 250, easing: 'linear', delay: 0, fade: { opacity: 0 } },
		};
		const outgoing = { network: 'twitch' as const, networkLabel: 'Twitch', handle: 'alpha', profileUrl: 'https://www.twitch.tv/alpha' };
		const model = resolveBroadcastGraphicsRenderModel({
			output: 'overlay',
			...CANVAS,
			graphics: [social],
			onAirGraphicIds: ['lower-third'],
			animation: { 'lower-third': [{ phase: 'update', elapsed: 125 }] },
			socialProfilePresentations: { 'lower-third': { profile: {
				phase: { kind: 'static', elapsedMs: 0, durationMs: null },
				layers: [],
			} } },
			outgoingSocialProfileValues: { 'lower-third': { profile: outgoing } },
			outgoingSocialProfilePresentations: { 'lower-third': { profile: {
				phase: { kind: 'static', elapsedMs: 0, durationMs: null },
				layers: [{ values: outgoing, opacity: 1, offsetX: 0, offsetY: 0 }],
			} } },
		});
		const transition = model.graphics[0]!.items[0]!.crossTransition!;

		expect(transition.outgoing.presentationLayers?.[0]?.children?.[0]?.text)
			.toBe('Twitch · alpha · https://www.twitch.tv/alpha');
		expect(transition.outgoing.presentationLayers?.[0]?.children?.[1]?.icon?.name)
			.toBe('i-simple-icons-twitch');
		expect(transition.incoming.style.visibility).toBe('hidden');
	});

	it.each(['enter', 'exit'] as const)('nests the synchronized Presentation Group transition inside %s motion', (phase) => {
		const social = projectedGraphic();
		(social.items[0] as GraphicGroupItemConfig).animation = {
			enter: {
				duration: 1_000,
				easing: 'linear',
				delay: 0,
				fade: { opacity: 0 },
				slide: { direction: 'south', distanceMode: 'fixed', distance: 100 },
			},
			exit: {
				duration: 1_000,
				easing: 'linear',
				delay: 0,
				fade: { opacity: 0 },
				slide: { direction: 'south', distanceMode: 'fixed', distance: 100 },
			},
		};
		const outgoing = { network: 'twitch' as const, networkLabel: 'Twitch', handle: 'alpha', profileUrl: 'https://www.twitch.tv/alpha' };
		const incoming = { network: 'youtube' as const, networkLabel: 'YouTube', handle: 'bravo', profileUrl: 'https://www.youtube.com/@bravo' };
		const model = resolveBroadcastGraphicsRenderModel({
			output: 'overlay',
			...CANVAS,
			graphics: [social],
			onAirGraphicIds: ['lower-third'],
			animation: { 'lower-third': [{ phase, elapsed: 500 }] },
			socialProfilePresentations: {
				'lower-third': {
					profile: {
						phase: { kind: 'transition', elapsedMs: 125, durationMs: 250 },
						layers: [
							{ values: outgoing, opacity: 1, offsetX: -50, offsetY: 0 },
							{ values: incoming, opacity: 1, offsetX: 50, offsetY: 0 },
						],
					},
				},
			},
		});
		const group = model.graphics[0]!.items[0]!;

		expect(group.style).toMatchObject({ opacity: 0.5, overflow: 'hidden' });
		expect(String(group.style.transform)).toContain('translate(0px, 50px)');
		expect(group.presentationLayers?.map(layer => layer.style.transform)).toEqual([
			'translate(-50%, 0%)',
			'translate(50%, 0%)',
		]);
	});

	it('preserves both concurrent lifecycle reveal masks around Social Profile layers', () => {
		const social = projectedGraphic();
		(social.items[0] as GraphicGroupItemConfig).animation = {
			'on-screen': { duration: 400, easing: 'linear', delay: 0, pause: 0, repeat: 1, reveal: { edge: 'top' } },
			'exit': { duration: 400, easing: 'linear', delay: 0, reveal: { edge: 'left' } },
		};
		const current = { network: 'youtube' as const, networkLabel: 'YouTube', handle: 'bravo', profileUrl: 'https://www.youtube.com/@bravo' };
		const model = resolveBroadcastGraphicsRenderModel({
			output: 'overlay',
			...CANVAS,
			graphics: [social],
			onAirGraphicIds: ['lower-third'],
			animation: { 'lower-third': [
				{ phase: 'on-screen', elapsed: 100 },
				{ phase: 'exit', elapsed: 200 },
			] },
			socialProfilePresentations: { 'lower-third': { profile: {
				phase: { kind: 'transition', elapsedMs: 125, durationMs: 250 },
				layers: [{ values: current, opacity: 0.5, offsetX: 0, offsetY: 0 }],
			} } },
		});
		const group = model.graphics[0]!.items[0]!;

		expect(group.style.maskImage).toBe('linear-gradient(to right, #ffffff 0 50%, #ffffff00 50%)');
		expect(group.enclosed?.style.maskImage).toBe('linear-gradient(to bottom, #ffffff 0 50%, #ffffff00 50%)');
		expect(group.enclosed?.presentationLayers).toHaveLength(1);
	});
});
