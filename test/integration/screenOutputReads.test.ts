import type { ScreenResponse } from '~~/shared/api';
import type { ScreenOutputFeatureMatchResponse, ScreenOutputPlayerDecksResponse, ScreenOutputStandingsResponse } from '~~/shared/types/screenOutputReads';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { $fetch, anonymousFetch } from './client';

/**
 * A Screen Output reads everything it renders with its Screen Output Asset
 * Capability alone (#604). Every request here past the setup is anonymous: no
 * session cookie, only the bearer an output's URL hash carries.
 */

interface JsonResponse<T = unknown> {
	status: number;
	data: T;
}

async function readJson<T>(response: Response): Promise<JsonResponse<T>> {
	const text = await response.text();
	return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
}

function bearer(capability: string): HeadersInit {
	return { authorization: `Bearer ${capability}` };
}

describe('capability-only Screen Output reads', () => {
	let eventId: number;
	let screen: ScreenResponse;
	let capability: string;
	let neighbourCapability: string;

	function outputPath(resource: string, screenId = screen.id) {
		return `/api/screen-output/events/${eventId}/screens/${screenId}${resource ? `/${resource}` : ''}`;
	}

	async function asOutput<T>(resource: string, credential: string | null = capability): Promise<JsonResponse<T>> {
		return await readJson<T>(await anonymousFetch(outputPath(resource), {
			headers: credential ? bearer(credential) : undefined,
		}));
	}

	/** Put the Screen in a mode: a capability reaches a mode's data only while its Screen is in that mode. */
	async function setMode(mode: string) {
		screen = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens/${screen.id}`, {
			method: 'PATCH',
			body: { currentMode: mode, stateVersion: screen.stateVersion },
		});
	}

	async function setModeConfig(mode: string, config: Record<string, unknown>) {
		screen = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens/${screen.id}/config/${mode}`, {
			method: 'PATCH',
			body: config,
		});
	}

	/** A further Screen in its own mode, read through its own capability. */
	async function outputScreen(mode: string) {
		const created = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: { name: `Output ${mode}`, slug: `output-reads-${mode}-${eventId}`, currentMode: mode },
		});
		const ownCapability = (await $fetch<{ assetCapability: string }>(
			`/api/events/${eventId}/screens/${created.id}/asset-capability`,
		)).assetCapability;
		return {
			screen: created,
			capability: ownCapability,
			async configure(config: Record<string, unknown>) {
				await $fetch(`/api/events/${eventId}/screens/${created.id}/config/${mode}`, { method: 'PATCH', body: config });
			},
			async read<T>(resource: string, credential: string | null = ownCapability, query = '') {
				return await readJson<T>(await anonymousFetch(`${outputPath(resource, created.id)}${query}`, {
					headers: credential ? bearer(credential) : undefined,
				}));
			},
		};
	}

	beforeAll(async () => {
		const event = await $fetch<{ id: number }>('/api/events', {
			method: 'POST',
			body: { name: 'Screen Output Reads Event', game: 'mtg', featureMatchOrientation: 'vertical' },
		});
		eventId = event.id;
		await $fetch(`/api/events/${eventId}`, {
			method: 'PATCH',
			body: { description: 'Operator notes', displayRecordSeparator: '/' },
		});

		screen = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: { name: 'Programme', slug: `output-reads-${eventId}`, currentMode: 'background' },
		});
		capability = (await $fetch<{ assetCapability: string }>(
			`/api/events/${eventId}/screens/${screen.id}/asset-capability`,
		)).assetCapability;

		const neighbour = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: { name: 'Neighbour', slug: `output-reads-neighbour-${eventId}`, currentMode: 'background' },
		});
		neighbourCapability = (await $fetch<{ assetCapability: string }>(
			`/api/events/${eventId}/screens/${neighbour.id}/asset-capability`,
		)).assetCapability;
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	describe('the Event context', () => {
		it('answers the fields an output renders and nothing operator-only', async () => {
			const { status, data } = await asOutput<Record<string, unknown>>('event');

			expect(status).toBe(200);
			expect(data).toMatchObject({
				id: eventId,
				name: 'Screen Output Reads Event',
				game: 'mtg',
				featureMatchOrientation: 'vertical',
				displayRecordSeparator: '/',
			});
			for (const operatorOnly of ['meleeConfigured', 'meleeEventId', 'lastSyncError', 'lastPlayersSyncedAt', 'talents', 'description'])
				expect(data).not.toHaveProperty(operatorOnly);
		});

		it.each([
			['no credential', null],
			['another Screen\'s capability', 'neighbour'],
			['a malformed bearer', 'not a capability'],
		] as const)('refuses %s with the one non-enumerating 404', async (_case, credential) => {
			const presented = credential === 'neighbour' ? neighbourCapability : credential;
			const { status, data } = await asOutput<{ message?: string }>('event', presented);

			expect(status).toBe(404);
			expect(JSON.stringify(data)).not.toContain('Screen Output Reads Event');
		});

		it('keeps the ordinary Event read private', async () => {
			const response = await anonymousFetch(`/api/events/${eventId}`, { headers: bearer(capability) });
			expect(response.status).toBe(401);
		});
	});

	describe('the Screen and its later changes', () => {
		it('boots and follows an operator\'s change through capability reads alone', async () => {
			const output = await outputScreen('background');
			const lookup = async () => await readJson<ScreenResponse>(await anonymousFetch(
				`/api/screen-output/events/${eventId}/screens/slug/${output.screen.slug}`,
				{ headers: bearer(output.capability) },
			));
			const player = await $fetch<{ id: number }>(`/api/events/${eventId}/players`, { method: 'POST', body: { name: 'Later Player' } });

			const booted = await lookup();
			expect(booted.status).toBe(200);
			expect((await output.read('event')).status).toBe(200);

			await $fetch(`/api/events/${eventId}/screens/${output.screen.id}`, {
				method: 'PATCH',
				body: { currentMode: 'player-history', stateVersion: booted.data.stateVersion },
			});
			await $fetch(`/api/events/${eventId}/screens/${output.screen.id}/config/player-history`, {
				method: 'PATCH',
				body: { playerId: player.id },
			});

			const byId = await output.read<ScreenResponse>('');
			expect(byId.data).toMatchObject({ id: output.screen.id, currentMode: 'player-history' });

			const refreshed = await lookup();
			expect(refreshed.data).toMatchObject({
				currentMode: 'player-history',
				modeConfigs: { 'player-history': { playerId: player.id } },
			});
			expect((await output.read<{ player: { id: number } }>('player-history')).data.player.id).toBe(player.id);
		});

		it('stops answering a capability once it is rotated', async () => {
			const rotating = await outputScreen('card');
			const before = rotating.capability;
			const after = (await $fetch<{ assetCapability: string }>(
				`/api/events/${eventId}/screens/${rotating.screen.id}/asset-capability`,
				{ method: 'POST' },
			)).assetCapability;

			expect((await rotating.read('event', before)).status).toBe(404);
			expect((await rotating.read('event', after)).status).toBe(200);
		});
	});

	describe('a Screen\'s own live state', () => {
		it('reads the Card on the Screen', async () => {
			await $fetch(`/api/events/${eventId}/screens/${screen.id}/card`, {
				method: 'PUT',
				body: {
					id: 'output-card',
					name: 'Lightning Bolt',
					set: 'lea',
					layout: 'normal',
					imageData: { front: { small: 'https://example.com/s.jpg', normal: 'https://example.com/n.jpg' }, back: null },
					orientationData: { flipable: false, turnable: false, rotateable: false, counterRotateable: false },
					displayData: { flipped: false, rotated: false, counterRotated: false, turnedOver: false },
				},
			});

			expect((await asOutput('card')).status).toBe(404);
			await setMode('card');
			const { status, data } = await asOutput<{ card: { name: string }; revision: number }>('card');

			expect(status).toBe(200);
			// The Card with the revision it was read at, as the operator's read answers it (#734).
			expect(data).toEqual({
				card: expect.objectContaining({ id: 'output-card', name: 'Lightning Bolt' }),
				revision: expect.any(Number),
			});
			expect((await asOutput('card', neighbourCapability)).status).toBe(404);
		});

		it('reads the Broadcast Graphics Live Session snapshot', async () => {
			const graphics = await outputScreen('broadcast-graphics');
			const operator = await $fetch<{ id: number; sequence: number }>(
				`/api/events/${eventId}/screens/${graphics.screen.id}/broadcast-graphics/live-session`,
			);
			const read = (credential: string | null) => graphics.read<{ id: number; sequence: number }>('broadcast-graphics/live-session', credential);

			const { status, data } = await read(graphics.capability);

			expect(status).toBe(200);
			expect(data).toMatchObject({ id: operator.id, sequence: operator.sequence });
			expect((await read(capability)).status).toBe(404);
			expect((await read(null)).status).toBe(404);
		});
	});

	describe('standings', () => {
		it('reads the roster, the fixed Round and the watchlist the saved configuration names', async () => {
			const alpha = await $fetch<{ id: number }>(`/api/events/${eventId}/players`, { method: 'POST', body: { name: 'Standings Alpha' } });
			const beta = await $fetch<{ id: number }>(`/api/events/${eventId}/players`, { method: 'POST', body: { name: 'Standings Beta' } });
			const list = await $fetch<{ id: number }>(`/api/events/${eventId}/player-lists`, { method: 'POST', body: { name: 'Watch' } });
			await $fetch(`/api/events/${eventId}/player-lists/${list.id}/members`, { method: 'POST', body: { playerIds: [beta.id] } });
			const phase = await $fetch<{ id: number }>(`/api/events/${eventId}/phases`, { method: 'POST', body: { name: 'Swiss' } });
			const round = await $fetch<{ id: number }>(`/api/events/${eventId}/rounds`, {
				method: 'POST',
				body: { phaseId: phase.id, name: 'Round 1', roundNumber: 1 },
			});

			await setMode('standings');
			await setModeConfig('standings', { viewMode: 'all' });
			const current = await asOutput<ScreenOutputStandingsResponse>('standings');

			expect(current.status).toBe(200);
			expect(current.data.players.map(player => player.id)).toEqual(expect.arrayContaining([alpha.id, beta.id]));
			expect(current.data).toMatchObject({ round: null, roundStandings: null, watchlist: null });

			await setModeConfig('standings', { viewMode: 'watchlist', playerListId: list.id, roundId: round.id });
			const fixed = await asOutput<ScreenOutputStandingsResponse>('standings');

			expect(fixed.data).toMatchObject({
				round: { id: round.id, name: 'Round 1' },
				roundStandings: [],
				watchlist: { name: 'Watch', playerIds: [beta.id] },
			});
			expect((await asOutput('standings', null)).status).toBe(404);
		});
	});

	describe('metagame and Top Cards', () => {
		it('reads the breakdown the saved Metagame view renders, following a change of view', async () => {
			await setMode('metagame');
			await setModeConfig('metagame', { viewMode: 'archetype', scope: 'all' });
			const archetypes = await asOutput<{ viewMode: string; breakdown: unknown }>('metagame');
			const operatorArchetypes = await $fetch(`/api/events/${eventId}/metagame/archetypes`, { query: { scope: 'all', sortBy: 'metaShare' } });

			expect(archetypes).toEqual({ status: 200, data: { viewMode: 'archetype', breakdown: operatorArchetypes } });

			await setModeConfig('metagame', { viewMode: 'cards', limit: 7 });
			const cards = await asOutput<{ viewMode: string; breakdown: unknown }>('metagame');
			const operatorCards = await $fetch(`/api/events/${eventId}/metagame/cards`, { query: { scope: 'all', sortBy: 'inclusionRate', limit: 7 } });

			expect(cards).toEqual({ status: 200, data: { viewMode: 'cards', breakdown: operatorCards } });
		});

		it('reads the card breakdown the saved Top Cards configuration renders', async () => {
			await setMode('top-cards');
			await setModeConfig('top-cards', { scope: 'all', limit: 5 });
			const { status, data } = await asOutput('top-cards');

			expect(status).toBe(200);
			expect(data).toMatchObject({ scope: 'all', entries: [] });
			expect((await asOutput('top-cards', neighbourCapability)).status).toBe(404);
		});
	});

	describe('feature Match', () => {
		it('reads the shown Slot and its Players\' decks, and nothing the Screen does not show', async () => {
			const playerOne = await $fetch<{ id: number }>(`/api/events/${eventId}/players`, { method: 'POST', body: { name: 'Slot Player One' } });
			const playerTwo = await $fetch<{ id: number }>(`/api/events/${eventId}/players`, { method: 'POST', body: { name: 'Slot Player Two' } });
			const bystander = await $fetch<{ id: number }>(`/api/events/${eventId}/players`, { method: 'POST', body: { name: 'Bystander' } });
			const shown = await $fetch<{ id: number }>(`/api/events/${eventId}/feature-match-slots`, {
				method: 'POST',
				body: { player1Id: playerOne.id, player2Id: playerTwo.id },
			});
			const hidden = await $fetch<{ id: number }>(`/api/events/${eventId}/feature-match-slots`, { method: 'POST', body: {} });
			const overlay = await outputScreen('feature-match');
			await overlay.configure({ featureMatchId: shown.id });

			const slot = await overlay.read<ScreenOutputFeatureMatchResponse>(`feature-match-slots/${shown.id}`);
			expect(slot.status).toBe(200);
			expect(slot.data).toMatchObject({
				slot: { id: shown.id, player1Id: playerOne.id, player2Id: playerTwo.id },
				match: null,
				round: null,
				phase: null,
			});

			const decks = await overlay.read<ScreenOutputPlayerDecksResponse>(`players/${playerTwo.id}/decks`);
			expect(decks.status).toBe(200);
			expect(decks.data).toMatchObject({ player: { id: playerTwo.id, name: 'Slot Player Two' }, decks: { decks: [] } });

			expect((await overlay.read(`feature-match-slots/${hidden.id}`)).status).toBe(404);
			expect((await overlay.read(`players/${bystander.id}/decks`)).status).toBe(404);
			expect((await overlay.read(`feature-match-slots/${shown.id}`, capability)).status).toBe(404);
		});

		it('lets an operator\'s preview read a Slot it has not saved', async () => {
			const unsaved = await $fetch<{ id: number }>(`/api/events/${eventId}/feature-match-slots`, { method: 'POST', body: {} });
			const overlay = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens`, {
				method: 'POST',
				body: { name: 'Preview', slug: `output-reads-preview-${eventId}`, currentMode: 'feature-match-overlay' },
			});

			const preview = await $fetch<ScreenOutputFeatureMatchResponse>(outputPath(`feature-match-slots/${unsaved.id}`, overlay.id));
			expect(preview.slot.id).toBe(unsaved.id);
		});
	});

	describe('deck', () => {
		it('reads the selected Player\'s decks only while the Deck mode selects them', async () => {
			const selected = await $fetch<{ id: number }>(`/api/events/${eventId}/players`, { method: 'POST', body: { name: 'Deck Player' } });
			const deck = await outputScreen('deck');

			expect((await deck.read(`players/${selected.id}/decks`)).status).toBe(404);

			await deck.configure({ deckSource: { type: 'player', playerId: selected.id } });
			const read = await deck.read<ScreenOutputPlayerDecksResponse>(`players/${selected.id}/decks`);

			expect(read.status).toBe(200);
			expect(read.data.player).toMatchObject({ id: selected.id, name: 'Deck Player' });
		});
	});

	describe('player History', () => {
		it('reads the history of the Player the Screen names, and only while it names one', async () => {
			const player = await $fetch<{ id: number }>(`/api/events/${eventId}/players`, {
				method: 'POST',
				body: { name: 'History Player' },
			});

			await setMode('player-history');
			expect((await asOutput('player-history')).status).toBe(404);

			await setModeConfig('player-history', { playerId: player.id });
			const { status, data } = await asOutput<{ player: { id: number; name: string }; history: unknown[] }>('player-history');

			expect(status).toBe(200);
			expect(data.player).toMatchObject({ id: player.id, name: 'History Player' });
			expect(data.history).toEqual([]);

			// The configuration stays saved, but a Screen in another mode no longer
			// publishes it.
			await setMode('background');
			expect((await asOutput('player-history')).status).toBe(404);
			expect((await asOutput('standings')).status).toBe(404);
		});
	});
});
