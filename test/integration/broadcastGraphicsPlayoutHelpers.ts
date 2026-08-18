import type { ScreenResponse } from '~~/shared/api';
import type {
	BroadcastGraphicsCommand,
	BroadcastGraphicsCommandResult,
	BroadcastGraphicsLiveSessionResponse,
} from '~~/shared/types/broadcastGraphicsLiveSession';
import type { ScreenMode } from '~~/shared/types/enums';
import type {
	BroadcastGraphicConfig,
	GraphicChannelConfig,
	GraphicInputDeclaration,
} from '~~/shared/types/graphics';
import { $fetch } from './client';

const SQUARE_CORNER = { treatment: 'square', size: 0 } as const;

let nextCommandId = 0;

export function playoutCommandId(prefix: string): string {
	nextCommandId += 1;
	return `${prefix}:integration:${nextCommandId}`;
}

/**
 * A Broadcast Graphic that declares typed Graphic Inputs and renders them.
 *
 * Its Text Graphic Item holds a Graphic Text Template, so the declarations, the
 * placeholders, and the Graphic Placeholder Style all travel through the same
 * write an editor would make. Written out longhand because the integration project
 * resolves no `~~` alias: only type imports cross this boundary.
 */
export function integrationBroadcastGraphicWithInputs(
	id: string,
	inputs: GraphicInputDeclaration[],
	animation?: BroadcastGraphicConfig['animation'],
): BroadcastGraphicConfig {
	return {
		id,
		name: `Graphic ${id}`,
		inputs,
		...(animation === undefined ? {} : { animation }),
		items: [{
			id: `${id}-text`,
			label: 'Name',
			type: 'text',
			visible: true,
			anchor: 'top-left',
			x: 0,
			y: 0,
			width: 600,
			height: 120,
			text: '{name} — {title}',
			typography: {
				font: { kind: 'application', fontId: 'inter' },
				fontSize: 48,
				fontWeight: 700,
				fontStyle: 'normal',
				textTransform: 'none',
				letterSpacing: 0,
				lineHeight: 1.2,
				textAlign: 'left',
				color: '#ffffff',
			},
			overflowPolicy: 'ellipsis',
			minFontSize: 24,
			placeholderStyles: { title: { fontWeight: 300 } },
		}],
	};
}

/**
 * A whole-graphic Graphic Animation with the phases a test needs and nothing else.
 *
 * Written longhand for the same reason as everything else here: the integration
 * project resolves no `~~` alias, so only type imports cross this boundary.
 */
export function integrationGraphicAnimation(
	durations: { enter?: number; update?: number; exit?: number; onScreen?: number },
): NonNullable<BroadcastGraphicConfig['animation']> {
	const recipe = (duration: number) => ({
		duration,
		easing: 'linear' as const,
		delay: 0,
		fade: { opacity: 0 },
	});

	return {
		...(durations.enter === undefined ? {} : { enter: recipe(durations.enter) }),
		...(durations.update === undefined ? {} : { update: recipe(durations.update) }),
		...(durations.exit === undefined ? {} : { exit: recipe(durations.exit) }),
		// An on-screen recipe cycles rather than travelling once, so it carries a pause and
		// a repetition the finite phases have no use for. Indefinite, because that is the
		// case an exit has to be able to interrupt at any point in the excursion.
		...(durations.onScreen === undefined
			? {}
			: { 'on-screen': { ...recipe(durations.onScreen), pause: 0, repeat: 'indefinite' as const } }),
	};
}

/**
 * The same graphic, plus the Graphic Source Selections and Graphic Input Bindings a
 * placed Broadcast Graphic owns.
 *
 * Written through the ordinary Screen write so the declarations, the bindings, and
 * the derivations all pass the schema an editor writes through.
 */
export function integrationBroadcastGraphicWithBindings(
	id: string,
	inputs: GraphicInputDeclaration[],
	sources: BroadcastGraphicConfig['sources'],
	bindings: BroadcastGraphicConfig['bindings'],
): BroadcastGraphicConfig {
	return { ...integrationBroadcastGraphicWithInputs(id, inputs), sources, bindings };
}

/** A text Graphic Input, staged and optional unless stated otherwise. */
export function integrationTextInput(
	key: string,
	overrides: Partial<Extract<GraphicInputDeclaration, { type: 'text' }>> = {},
): GraphicInputDeclaration {
	return {
		type: 'text',
		key,
		label: key,
		required: false,
		updatePolicy: 'staged',
		default: '',
		maxLength: 20,
		...overrides,
	};
}

export async function selectBroadcastGraphicSource(
	harness: { send: (command: BroadcastGraphicsCommand) => Promise<BroadcastGraphicsCommandResult> },
	graphicId: string,
	sourceKey: string,
	selectionId: number | null,
): Promise<BroadcastGraphicsCommandResult> {
	return await harness.send({
		commandId: playoutCommandId(`select-${sourceKey}`),
		type: 'Select Source',
		payload: { graphicId, sourceKey, selectionId },
	} as BroadcastGraphicsCommand);
}

export async function setBroadcastGraphicOverride(
	harness: { send: (command: BroadcastGraphicsCommand) => Promise<BroadcastGraphicsCommandResult> },
	graphicId: string,
	inputKey: string,
	value: unknown,
): Promise<BroadcastGraphicsCommandResult> {
	return await harness.send({
		commandId: playoutCommandId(`override-${inputKey}`),
		type: 'Set Override',
		payload: { graphicId, inputKey, value },
	} as BroadcastGraphicsCommand);
}

export async function setBroadcastGraphicInput(
	harness: { send: (command: BroadcastGraphicsCommand) => Promise<BroadcastGraphicsCommandResult> },
	graphicId: string,
	inputKey: string,
	value: unknown,
): Promise<BroadcastGraphicsCommandResult> {
	return await harness.send({
		commandId: playoutCommandId(`set-${inputKey}`),
		type: 'Set Input',
		payload: { graphicId, inputKey, value },
	} as BroadcastGraphicsCommand);
}

/** A minimal but renderable Broadcast Graphic: one opaque Shape Graphic Item. */
export function integrationBroadcastGraphic(
	id: string,
	animation?: BroadcastGraphicConfig['animation'],
): BroadcastGraphicConfig {
	return {
		id,
		name: `Graphic ${id}`,
		...(animation === undefined ? {} : { animation }),
		items: [{
			id: `${id}-shape`,
			label: 'Panel',
			type: 'shape',
			visible: true,
			anchor: 'top-left',
			x: 0,
			y: 0,
			width: 400,
			height: 200,
			// Written out rather than built from the shared factory: the integration
			// project resolves no `~~` alias, so only type imports cross this boundary.
			geometry: {
				topLeft: SQUARE_CORNER,
				topRight: SQUARE_CORNER,
				bottomRight: SQUARE_CORNER,
				bottomLeft: SQUARE_CORNER,
				leftSlant: 0,
				rightSlant: 0,
			},
			surfaceStyle: { fill: { type: 'solid', color: '#101014' }, fillOpacity: 1 },
		}],
	};
}

export async function createBroadcastGraphicsScreen(
	eventId: number,
	slug: string,
	graphics: BroadcastGraphicConfig[],
	channels?: GraphicChannelConfig[],
): Promise<ScreenResponse> {
	return await $fetch<ScreenResponse>(`/api/events/${eventId}/screens`, {
		method: 'POST',
		body: {
			name: `Broadcast Graphics ${slug}`,
			slug,
			currentMode: 'broadcast-graphics',
			modeConfigs: {
				'broadcast-graphics': { graphics, ...(channels === undefined ? {} : { channels }) },
			},
		},
	});
}

export async function setScreenMode(
	eventId: number,
	screenId: number,
	currentMode: ScreenMode,
): Promise<ScreenResponse> {
	const screen = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens/${screenId}`);

	return await $fetch<ScreenResponse>(`/api/events/${eventId}/screens/${screenId}`, {
		method: 'PATCH',
		body: { currentMode, stateVersion: screen.stateVersion },
	});
}

export async function getBroadcastGraphicsLiveSession(
	eventId: number,
	screenId: number,
): Promise<BroadcastGraphicsLiveSessionResponse> {
	return await $fetch<BroadcastGraphicsLiveSessionResponse>(
		`/api/events/${eventId}/screens/${screenId}/broadcast-graphics/live-session`,
	);
}

export async function sendBroadcastGraphicsCommand(
	eventId: number,
	screenId: number,
	sessionId: number,
	command: BroadcastGraphicsCommand,
): Promise<BroadcastGraphicsCommandResult> {
	return await $fetch<BroadcastGraphicsCommandResult>(
		`/api/events/${eventId}/screens/${screenId}/broadcast-graphics/live-sessions/${sessionId}/commands`,
		{ method: 'POST', body: command },
	);
}

export interface PlayoutHarness {
	screen: ScreenResponse;
	session: () => BroadcastGraphicsLiveSessionResponse;
	reload: () => Promise<BroadcastGraphicsLiveSessionResponse>;
	send: (command: BroadcastGraphicsCommand) => Promise<BroadcastGraphicsCommandResult>;
}

/** A harness over a Screen whose Broadcast Graphics, and Graphic Channels, are supplied in full. */
export async function createGraphicsHarness(
	eventId: number,
	slug: string,
	graphics: BroadcastGraphicConfig[],
	channels?: GraphicChannelConfig[],
): Promise<PlayoutHarness> {
	const screen = await createBroadcastGraphicsScreen(eventId, slug, graphics, channels);
	let current = await getBroadcastGraphicsLiveSession(eventId, screen.id);

	return {
		screen,
		session: () => current,
		reload: async () => {
			current = await getBroadcastGraphicsLiveSession(eventId, screen.id);
			return current;
		},
		send: async (command) => {
			const result = await sendBroadcastGraphicsCommand(eventId, screen.id, current.id, command);
			current = result.session;
			return result;
		},
	};
}

export async function createPlayoutHarness(
	eventId: number,
	slug: string,
	graphicIds: string[],
): Promise<PlayoutHarness> {
	const screen = await createBroadcastGraphicsScreen(eventId, slug, graphicIds.map(id => integrationBroadcastGraphic(id)));
	let current = await getBroadcastGraphicsLiveSession(eventId, screen.id);

	return {
		screen,
		session: () => current,
		reload: async () => {
			current = await getBroadcastGraphicsLiveSession(eventId, screen.id);
			return current;
		},
		send: async (command) => {
			const result = await sendBroadcastGraphicsCommand(eventId, screen.id, current.id, command);
			current = result.session;
			return result;
		},
	};
}
