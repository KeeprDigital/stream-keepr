import type { ScreenResponse } from '~~/shared/api';
import type { ScreenOutputFeatureMatchResponse, ScreenOutputPlayerDecksResponse } from '~~/shared/types/screenOutputReads';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { $fetch, anonymousFetch } from './client';

/**
 * A Screen Output reads everything it renders with its Screen Output Asset
 * Capability alone (#604). Every request here past the setup is anonymous: no
 * session cookie, only the bearer an output's URL hash carries. This is the
 * wiring pass through a running server; what each read answers and refuses is
 * `test/unit/server/api/screen-output/screenOutputReads.sqlite.test.ts`, and what
 * its Screen channel tells an output is `screenOutputReads.realtime.test.ts`.
 */

interface JsonResponse<T = unknown> {
	status: number;
	data: T;
}

async function readJson<T>(response: Response): Promise<JsonResponse<T>> {
	const text = await response.text();
	return {
		status: response.status,
		data: (text
			? JSON.parse(text)
			: null) as T,
	};
}

function bearer(capability: string): HeadersInit {
	return { authorization: `Bearer ${capability}` };
}

describe('capability-only Screen Output reads', () => {
	let eventId: number;
	let screen: ScreenResponse;
	let capability: string;

	function outputPath(resource: string, screenId = screen.id) {
		return `/api/screen-output/events/${eventId}/screens/${screenId}${resource
			? `/${resource}`
			: ''}`;
	}

	async function asOutput<T>(resource: string, credential: string | null = capability): Promise<JsonResponse<T>> {
		return await readJson<T>(await anonymousFetch(outputPath(resource), {
			headers: credential
				? bearer(credential)
				: undefined,
		}));
	}

	/** A further Screen in its own mode, read through its own capability. */
	async function outputScreen(mode: string, label = mode) {
		const created = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: { name: `Output ${label}`, slug: `output-reads-${label.toLowerCase()}-${eventId}`, currentMode: mode },
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
					headers: credential
						? bearer(credential)
						: undefined,
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

		screen = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: { name: 'Programme', slug: `output-reads-${eventId}`, currentMode: 'background' },
		});
		capability = (await $fetch<{ assetCapability: string }>(
			`/api/events/${eventId}/screens/${screen.id}/asset-capability`,
		)).assetCapability;
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	describe('the Event context', () => {
		it('refuses a caller with no credential with the one non-enumerating 404', async () => {
			const { status, data } = await asOutput<{ message?: string }>('event', null);

			expect(status).toBe(404);
			expect(JSON.stringify(data)).not.toContain('Screen Output Reads Event');
		});

		it('keeps the ordinary Event read private', async () => {
			const response = await anonymousFetch(`/api/events/${eventId}`, {
				headers: bearer(capability),
			});
			expect(response.status).toBe(401);
		});
	});

	describe('the Screen and its later changes', () => {
		it('boots and follows an operator\'s change through capability reads alone', async () => {
			const output = await outputScreen('background');
			const lookup = async () => await readJson<ScreenResponse>(await anonymousFetch(
				`/api/screen-output/events/${eventId}/screens/slug/${output.screen.slug}`,
				{
					headers: bearer(output.capability),
				},
			));
			const player = await $fetch<{ id: number }>(`/api/events/${eventId}/players`, {
				method: 'POST',
				body: { name: 'Later Player' },
			});

			const booted = await lookup();
			expect(booted.status).toBe(200);
			expect((await output.read('event')).data).toMatchObject({ id: eventId, name: 'Screen Output Reads Event' });

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
				modeConfigs: {
					'player-history': { playerId: player.id },
				},
			});
			expect((await output.read<{ player: { id: number } }>('player-history')).data.player.id).toBe(player.id);
		});
	});

	// An output holding only its Screen Output Link exchanges it, anonymously and
	// naming no origin, for the capability every read above presents.
	describe('exchanging a Screen Output Link', () => {
		interface IssuedOutputAccess { assetCapability: string; outputLink: string }
		interface ExchangedOutputAccess { eventId: number; screenId: number; assetCapability: string }

		async function issue(screenId: number) {
			return await $fetch<IssuedOutputAccess>(`/api/events/${eventId}/screens/${screenId}/asset-capability`);
		}

		async function exchange(body: string | undefined, contentType = 'application/json') {
			const response = await anonymousFetch('/api/screen-output/link', {
				method: 'POST',
				headers: body === undefined
					? undefined
					: { 'content-type': contentType },
				body,
			});
			return {
				cacheControl: response.headers.get('cache-control'),
				retryAfter: response.headers.get('retry-after'),
				...await readJson<ExchangedOutputAccess & { statusCode?: number; message?: string }>(response),
			};
		}

		it('answers the capability the operator was handed, which then reads through the Screen', async () => {
			const output = await outputScreen('background', 'link-exchange');
			const issued = await issue(output.screen.id);
			expect(issued.assetCapability).toBe(output.capability);
			expect(issued.outputLink).toMatch(/^[1-9A-HJ-NP-Za-km-z]{14,23}$/);

			const exchanged = await exchange(JSON.stringify({ link: issued.outputLink }));

			expect(exchanged.status).toBe(200);
			expect(exchanged.cacheControl).toBe('private, no-store');
			expect(exchanged.data).toEqual({
				eventId,
				screenId: output.screen.id,
				assetCapability: output.capability,
			});
			expect((await output.read('event', exchanged.data.assetCapability)).status).toBe(200);
			expect((await asOutput('event', exchanged.data.assetCapability)).status).toBe(404);
		});

		it('refuses everything that is not a current link as a Screen Output read refuses', async () => {
			const { assetCapability } = await issue(screen.id);
			const reference = await asOutput<{ statusCode: number; message: string }>('event', null);
			expect(reference.status).toBe(404);

			// Every way a link can be wrong is in
			// `test/unit/server/api/screen-output/link.post.sqlite.test.ts`. These are the
			// bodies only a real request carries, and one well-formed link that is not one.
			const presented: Array<[body: string | undefined, contentType?: string]> = [
				[undefined],
				['not json'],
				['not json', 'text/plain'],
				[
					JSON.stringify({ link: assetCapability }),
				],
			];
			for (const [body, contentType] of presented) {
				const refused = await exchange(body, contentType);
				expect(refused.status, String(body)).toBe(404);
				expect(refused.data.statusCode, String(body)).toBe(reference.data.statusCode);
				expect(refused.data.message, String(body)).toBe(reference.data.message);
				expect(refused.retryAfter, String(body)).toBeNull();
			}
		});

		it('is not a read: the link in a query, or as a bearer, opens nothing', async () => {
			const { outputLink, assetCapability } = await issue(screen.id);

			// A GET has no handler here and is answered by the app shell: it hands nothing over.
			const asked = await anonymousFetch(`/api/screen-output/link?link=${outputLink}`);
			expect(await asked.text()).not.toContain(assetCapability);
			expect((await asOutput('event', outputLink)).status).toBe(404);
		});
	});

	// The two reads whose client names the resource, through real route and query parsing.
	describe('feature Match', () => {
		it('reads the shown Slot and a seated Player\'s decks', async () => {
			const player = await $fetch<{ id: number }>(`/api/events/${eventId}/players`, {
				method: 'POST',
				body: { name: 'Slot Player' },
			});
			const shown = await $fetch<{ id: number }>(`/api/events/${eventId}/feature-match-slots`, {
				method: 'POST',
				body: { player1Id: player.id },
			});
			const overlay = await outputScreen('feature-match');
			await overlay.configure({ featureMatchId: shown.id });

			const slot = await overlay.read<ScreenOutputFeatureMatchResponse>(`feature-match-slots/${shown.id}`);
			expect(slot.status).toBe(200);
			expect(slot.data.slot).toMatchObject({ id: shown.id, player1Id: player.id });

			const decks = await overlay.read<ScreenOutputPlayerDecksResponse>(`players/${player.id}/decks`, overlay.capability, '?deckId=1');
			expect(decks.status).toBe(200);
			expect(decks.data).toMatchObject({
				player: { id: player.id, name: 'Slot Player' },
				decks: { decks: [] },
			});
		});
	});
});
