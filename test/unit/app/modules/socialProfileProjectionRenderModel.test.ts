import type { BroadcastGraphicsRenderModelInput } from '~~/app/modules/broadcast-graphics/renderModel';
import type {
	BroadcastGraphicConfig,
	GraphicAnimation,
	GraphicContainerAnimation,
	GraphicGroupItemConfig,
	SocialNetworkIconGraphicItemConfig,
	TextGraphicItemConfig,
} from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import { resolveBroadcastGraphicsRenderModel } from '~~/app/modules/broadcast-graphics/renderModel';
import { addGraphicGroupChild, addGraphicItem } from '~~/shared/modules/graphics';
import { CANVAS } from '~~/test/helpers/graphicsComposition';

const TWITCH = {
	network: 'twitch' as const,
	networkLabel: 'Twitch',
	handle: 'alpha',
	profileUrl: 'https://www.twitch.tv/alpha',
};
const YOUTUBE = {
	network: 'youtube' as const,
	networkLabel: 'YouTube',
	handle: 'bravo',
	profileUrl: 'https://www.youtube.com/@bravo',
};
const TWITCH_TEXT = 'Twitch · alpha · https://www.twitch.tv/alpha';
const YOUTUBE_TEXT = 'YouTube · bravo · https://www.youtube.com/@bravo';

const FADE_UPDATE = {
	update: {
		duration: 250,
		easing: 'linear',
		delay: 0,
		fade: { opacity: 0 },
	},
} satisfies GraphicAnimation;

/** A talent lower third whose Presentation Group renders one projected profile as text and icon. */
function projectedGraphic(groupAnimation?: GraphicContainerAnimation): BroadcastGraphicConfig {
	let graphic = addGraphicItem(
		{ id: 'lower-third', name: 'Talent lower third', items: [] },
		{ kind: 'group', id: 'profile-group', ...CANVAS },
	).graphic;
	graphic = addGraphicGroupChild(graphic, { kind: 'text', groupId: 'profile-group', id: 'profile-text' }).graphic;
	graphic = addGraphicGroupChild(graphic, { kind: 'social-network-icon', groupId: 'profile-group', id: 'profile-icon' }).graphic;
	const group = graphic.items[0] as GraphicGroupItemConfig;
	(group.children[0] as TextGraphicItemConfig).text = '{profile.networkLabel} · {profile.handle} · {profile.profileUrl}';
	(group.children[1] as SocialNetworkIconGraphicItemConfig).network = { projectionKey: 'profile' };
	group.animation = groupAnimation;
	graphic.sources = [
		{ key: 'talent', label: 'Talent', kind: 'talent' },
	];
	graphic.socialProfileProjections = [
		{
			key: 'profile',
			label: 'Profile',
			sourceKey: 'talent',
			presentationGroupId: 'profile-group',
			dwellMs: 8_000,
			transition: 'crossfade',
			transitionDurationMs: 250,
		},
	];
	return graphic;
}

function layer(values: typeof TWITCH | typeof YOUTUBE, opacity = 1, offsetX = 0) {
	return { values, opacity, offsetX, offsetY: 0 };
}

function presentation(layers: ReturnType<typeof layer>[], transitioning = false) {
	const phase = transitioning
		? { kind: 'transition' as const, elapsedMs: 125, durationMs: 250 }
		: { kind: 'static' as const, elapsedMs: 0, durationMs: null };
	return {
		'lower-third': {
			profile: { phase, layers },
		},
	};
}

function values(profile: typeof TWITCH | typeof YOUTUBE) {
	return {
		'lower-third': { profile },
	};
}

function render(graphic: BroadcastGraphicConfig, input: Partial<BroadcastGraphicsRenderModelInput> = {}) {
	return resolveBroadcastGraphicsRenderModel({
		output: 'overlay',
		...CANVAS,
		graphics: [graphic],
		onAirGraphicIds: ['lower-third'],
		...input,
	});
}

const UPDATING = {
	animation: {
		'lower-third': [
			{ phase: 'update' as const, elapsed: 125 },
		],
	},
};

describe('programmatic Social Profile Projection rendering', () => {
	it('renders one correlated profile through ordinary text and icon children', () => {
		const group = render(projectedGraphic(), {
			socialProfileValues: values(TWITCH),
		}).graphics[0]!.items[0]!;

		expect(group.kind).toBe('group');
		expect(group.children?.[0]?.text).toBe(TWITCH_TEXT);
		expect(group.children?.[1]?.icon?.name).toBe('i-simple-icons-twitch');
	});

	it('omits the whole Presentation Group until an atomic profile tuple is available', () => {
		expect(render(projectedGraphic()).graphics[0]!.items).toEqual([]);
	});

	it('renders the synchronized transition as correlated Presentation Group layers clipped to its boundary', () => {
		const group = render(projectedGraphic(), {
			socialProfilePresentations: presentation([
				layer(TWITCH, 1, -50),
				layer(YOUTUBE, 1, 50),
			], true),
		}).graphics[0]!.items[0]!;

		expect(group.style).toMatchObject({ overflow: 'hidden' });
		expect(group.presentationLayers?.map(entry => ({
			style: entry.style,
			text: entry.children?.[0]?.text,
			icon: entry.children?.[1]?.icon?.name,
		}))).toEqual([
			{
				style: expect.objectContaining({ opacity: 1, transform: 'translate(-50%, 0%)' }),
				text: TWITCH_TEXT,
				icon: 'i-simple-icons-twitch',
			},
			{
				style: expect.objectContaining({ opacity: 1, transform: 'translate(50%, 0%)' }),
				text: YOUTUBE_TEXT,
				icon: 'i-simple-icons-youtube',
			},
		]);
	});

	it('preserves an interrupted layered presentation beneath explicit Update Graphic', () => {
		const transition = render(projectedGraphic(FADE_UPDATE), {
			...UPDATING,
			socialProfileValues: values(YOUTUBE),
			outgoingSocialProfileValues: values(YOUTUBE),
			socialProfilePresentations: presentation([
				layer(YOUTUBE),
			]),
			outgoingSocialProfilePresentations: presentation([
				layer(TWITCH, 0.5),
				layer(YOUTUBE, 0.5),
			]),
		}).graphics[0]!.items[0]!.crossTransition!;

		expect(transition.outgoing.presentationLayers?.map(entry => entry.children?.[0]?.text)).toEqual([TWITCH_TEXT, YOUTUBE_TEXT]);
		expect(transition.incoming.presentationLayers?.[0]?.children?.[0]?.text).toBe(YOUTUBE_TEXT);
	});

	it('preserves child-owned update motion when exact presentation frames create the pair', () => {
		const social = projectedGraphic();
		(social.items[0] as GraphicGroupItemConfig).children[0]!.animation = FADE_UPDATE;

		const transition = render(social, {
			...UPDATING,
			socialProfileValues: values(YOUTUBE),
			outgoingSocialProfileValues: values(YOUTUBE),
			socialProfilePresentations: presentation([
				layer(YOUTUBE),
			]),
			outgoingSocialProfilePresentations: presentation([
				layer(TWITCH, 0.5),
				layer(YOUTUBE, 0.5),
			]),
		}).graphics[0]!.items[0]!.crossTransition!;

		expect(transition.outgoing.presentationLayers?.map(entry => entry.children?.[0]?.style.opacity)).toEqual([0.5, 0.5]);
		expect(transition.incoming.presentationLayers?.[0]?.children?.[0]?.style.opacity).toBe(0.5);
	});

	it('uses the update recipe to cross the outgoing and incoming correlated Social Profile values', () => {
		const transition = render(projectedGraphic(FADE_UPDATE), {
			...UPDATING,
			socialProfileValues: values(YOUTUBE),
			outgoingSocialProfileValues: values(TWITCH),
		}).graphics[0]!.items[0]!.crossTransition!;

		expect(transition.outgoing.children?.[0]?.text).toBe(TWITCH_TEXT);
		expect(transition.outgoing.children?.[1]?.icon?.name).toBe('i-simple-icons-twitch');
		expect(transition.incoming.children?.[0]?.text).toBe(YOUTUBE_TEXT);
		expect(transition.incoming.children?.[1]?.icon?.name).toBe('i-simple-icons-youtube');
	});

	it('uses the update recipe to animate an available Presentation Group to transparency', () => {
		const transition = render(projectedGraphic(FADE_UPDATE), {
			...UPDATING,
			socialProfilePresentations: presentation([]),
			outgoingSocialProfileValues: values(TWITCH),
			outgoingSocialProfilePresentations: presentation([
				layer(TWITCH),
			]),
		}).graphics[0]!.items[0]!.crossTransition!;

		expect(transition.outgoing.presentationLayers?.[0]?.children?.[0]?.text).toBe(TWITCH_TEXT);
		expect(transition.outgoing.presentationLayers?.[0]?.children?.[1]?.icon?.name).toBe('i-simple-icons-twitch');
		expect(transition.incoming.style.visibility).toBe('hidden');
	});

	it.each(['enter', 'exit'] as const)('nests the synchronized Presentation Group transition inside %s motion', (phase) => {
		const motion = {
			duration: 1_000,
			easing: 'linear' as const,
			delay: 0,
			fade: { opacity: 0 },
			slide: { direction: 'south' as const, distanceMode: 'fixed' as const, distance: 100 },
		};
		const group = render(projectedGraphic({ enter: motion, exit: motion }), {
			animation: {
				'lower-third': [
					{ phase, elapsed: 500 },
				],
			},
			socialProfilePresentations: presentation([
				layer(TWITCH, 1, -50),
				layer(YOUTUBE, 1, 50),
			], true),
		}).graphics[0]!.items[0]!;

		expect(group.style).toMatchObject({ opacity: 0.5, overflow: 'hidden' });
		expect(String(group.style.transform)).toContain('translate(0px, 50px)');
		expect(group.presentationLayers?.map(entry => entry.style.transform)).toEqual(['translate(-50%, 0%)', 'translate(50%, 0%)']);
	});

	it('preserves both concurrent lifecycle reveal masks around Social Profile layers', () => {
		const group = render(projectedGraphic({
			'on-screen': {
				duration: 400,
				easing: 'linear',
				delay: 0,
				pause: 0,
				repeat: 1,
				reveal: { edge: 'top' },
			},
			'exit': {
				duration: 400,
				easing: 'linear',
				delay: 0,
				reveal: { edge: 'left' },
			},
		}), {
			animation: {
				'lower-third': [
					{ phase: 'on-screen', elapsed: 100 },
					{ phase: 'exit', elapsed: 200 },
				],
			},
			socialProfilePresentations: presentation([
				layer(YOUTUBE, 0.5),
			], true),
		}).graphics[0]!.items[0]!;

		expect(group.style.maskImage).toBe('linear-gradient(to right, #ffffff 0 50%, #ffffff00 50%)');
		expect(group.enclosed?.style.maskImage).toBe('linear-gradient(to bottom, #ffffff 0 50%, #ffffff00 50%)');
		expect(group.enclosed?.presentationLayers).toHaveLength(1);
	});
});
