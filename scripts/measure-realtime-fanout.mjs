/**
 * Measure a typical show's realtime cost through the real stack.
 *
 * Real workerd serving the built Worker, a real Ably key, real Ably Realtime
 * connections authorised through the product's own `/api/realtime/token` route,
 * and the same command sequence an operator issues. What is counted is what
 * Ably bills: one inbound per publish, plus one outbound per subscriber that
 * receives it.
 *
 * Every count here has a way of being silently zero — a client that never
 * attached, a channel name that never matches, a workload that fails before it
 * publishes. Each is asserted rather than assumed, and the run fails loudly
 * instead of reporting a flattering zero.
 *
 * This is the instrument that produced #189's fan-out figures — ×6 on the Event
 * channel, ×2 on a Screen channel, five distinct connections — against which the
 * free plan's message allowance was judged. It lives in the repository rather
 * than in a scratch directory because the next person to ask whether this
 * installation still fits the free plan needs the same instrument, not a
 * reconstruction of it.
 *
 * Nothing here is a gate: `pnpm test` does not run it, and it cannot run at all
 * without a live installation and a real Ably key. Run it deliberately, and read
 * `PROBE_ORIGIN` below before you do.
 */

import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import Ably from 'ably';
import { openOperatorSessionForOrigin } from './graphics-acceptance/operator.mjs';

/**
 * What this probe throws when it will not start. A class rather than a bare
 * `Error` so a caller — the unit test included — can tell a refusal apart from a
 * failure that happened during a measurement.
 */
export class RealtimeFanoutProbeRefusal extends Error {
	constructor(message) {
		super(message);
		this.name = 'RealtimeFanoutProbeRefusal';
	}
}

/**
 * The origin is deliberately not defaulted, on the same ground
 * `acceptanceOrigin` refuses to default the deployed one — "an acceptance run
 * that silently pointed at the wrong installation would be worse than one that
 * refused to start" — and the ground is firmer here.
 *
 * That harness reads. This one **writes**: it provisions an Event, three Screen
 * Outputs and a live session, drives dozens of commands through them, and its
 * cleanup swallows its own failures, so a run that dies partway leaves what it
 * made behind. And the origin it used to default to, `http://127.0.0.1:8787`, is
 * not this worktree's port — it is the one every worktree on the machine shares.
 * Round nine has a recorded incident of a harness on 8787 writing a full
 * scenario into a sibling lane's D1 and R2 (`docs/agents/parallel-rounds.md`,
 * "A local harness run is a cross-worktree write"), and that harness was the
 * reading one.
 *
 * So there is no default. The caller names the installation it is willing to
 * have written to, and a caller who names nothing gets a refusal rather than
 * somebody else's database.
 */
export function probeOrigin(env = process.env) {
	const configured = env.PROBE_ORIGIN?.trim();
	if (!configured) {
		throw new RealtimeFanoutProbeRefusal(
			'PROBE_ORIGIN is unset, and this probe will not guess an installation: it provisions '
			+ 'an Event, three Screen Outputs and a live session against whatever answers, and '
			+ '127.0.0.1:8787 is shared by every worktree on this machine. Name the installation '
			+ 'you started yourself — PROBE_ORIGIN=http://127.0.0.1:8799 node scripts/measure-realtime-fanout.mjs',
		);
	}
	return configured.replace(/\/$/, '');
}

/** Set by `main` from `probeOrigin`, and read by `api`. Never defaulted. */
let origin;
const CYCLES = Number(process.env.PROBE_CYCLES ?? 5);
const OPERATOR_CONSOLES = 2;

let cookie;
let commandSeq = 0;

async function api(path, init = {}) {
	const headers = new Headers(init.headers ?? {});
	if (cookie)
		headers.set('cookie', cookie);
	let body = init.body;
	if (body !== undefined) {
		headers.set('content-type', 'application/json');
		body = JSON.stringify(body);
	}
	const response = await fetch(`${origin}${path}`, { method: init.method ?? 'GET', headers, body });
	const text = await response.text();
	if (!response.ok)
		throw new Error(`${init.method ?? 'GET'} ${path} -> ${response.status}: ${text.slice(0, 200)}`);
	return text.length === 0 ? undefined : JSON.parse(text);
}

function lowerThirdGraphic(id) {
	return {
		id,
		name: `Graphic ${id}`,
		inputs: [
			{ type: 'text', key: 'name', label: 'name', required: false, updatePolicy: 'staged', default: '', maxLength: 40 },
			{ type: 'text', key: 'title', label: 'title', required: false, updatePolicy: 'staged', default: '', maxLength: 40 },
		],
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
			placeholderStyles: {},
		}],
	};
}

async function main() {
	origin = probeOrigin();
	// Said out loud before anything is created, because the failure this guards
	// against is writing to an installation nobody meant to name.
	process.stderr.write(`measure-realtime-fanout: provisioning against ${origin}\n`);

	const marker = randomUUID().slice(0, 8);

	// ------------------------------------------------------------ provisioning
	// Two credentials, and #396 is why there are two. The session is what gets a
	// request past the deny-by-default boundary over `/api/**` at all; the author
	// cookie says which Graphics Author owns what this probe provisions. Where the
	// session comes from — an account named in the environment, or one this probe
	// creates through the first-admin bootstrap — is `graphics-acceptance/operator.mjs`'s
	// decision, and it is not defaulted to a local file for a remote origin.
	const sessionCookies = await openOperatorSessionForOrigin(origin);

	const bootstrap = await fetch(`${origin}/`, { headers: { accept: 'text/html' }, redirect: 'manual' });
	const authorCookie = bootstrap.headers.getSetCookie().map(v => v.split(';', 1)[0]).find(v => v.includes('='));
	if (!authorCookie)
		throw new Error('no author session issued');
	cookie = [...sessionCookies, authorCookie].join('; ');

	const event = await api('/api/events', {
		method: 'POST',
		body: { name: `Issue189 fanout ${marker}`, game: 'mtg', featureMatchOrientation: 'horizontal' },
	});

	const graphicId = 'lower-third';
	const screens = [];
	for (const [index, mode] of [['a', 'broadcast-graphics'], ['b', 'feature-match-overlay'], ['c', 'broadcast-graphics']]) {
		screens.push(await api(`/api/events/${event.id}/screens`, {
			method: 'POST',
			body: {
				name: `Screen ${index} ${marker}`,
				slug: `issue189-fan-${index}-${marker}`,
				currentMode: mode,
				...(mode === 'broadcast-graphics'
					? { modeConfigs: { 'broadcast-graphics': { graphics: [lowerThirdGraphic(graphicId)] } } }
					: {}),
			},
		}));
	}

	const eventChannel = `event:${event.id}`;

	// -------------------------------------------------------------- subscribers
	/** One browser tab. The app opens exactly one Ably connection per tab. */
	function openClient(label, screenId) {
		const client = new Ably.Realtime({
			clientId: `${label}-${marker}`,
			authCallback: async (_params, callback) => {
				try {
					const request = await api(`/api/realtime/token?eventId=${event.id}`);
					callback(null, request);
				}
				catch (error) {
					callback(error instanceof Error ? error.message : String(error), null);
				}
			},
		});
		const received = [];
		return { label, screenId, client, received };
	}

	const clients = [];
	for (let i = 1; i <= OPERATOR_CONSOLES; i += 1)
		clients.push(openClient(`console${i}`));
	// Label by index, not by a slug suffix: every slug here ends in the same run
	// marker, so a suffix-derived label collapses all three outputs into one key.
	screens.forEach((screen, index) => {
		clients.push(openClient(`output${index + 1}`, screen.id));
	});

	await Promise.all(clients.map(entry => new Promise((resolveConnected, reject) => {
		entry.client.connection.once('connected', resolveConnected);
		entry.client.connection.once('failed', stateChange => reject(new Error(`${entry.label} failed: ${stateChange.reason?.message}`)));
	})));

	const connectionIds = clients.map(entry => entry.client.connection.id);
	if (connectionIds.some(id => !id) || new Set(connectionIds).size !== clients.length)
		throw new Error(`expected ${clients.length} distinct connection ids, got ${JSON.stringify(connectionIds)}`);

	function record(entry, channelName) {
		return (message) => {
			entry.received.push({
				channel: channelName,
				name: message.name,
				bytes: Buffer.byteLength(JSON.stringify(message.data), 'utf8'),
			});
		};
	}

	// Every tab joins the Event channel (the event-realtime-session plugin is
	// global and unconditional). A Screen Output additionally joins its own.
	for (const entry of clients) {
		const channel = entry.client.channels.get(eventChannel);
		await channel.subscribe(record(entry, 'event'));
		if (channel.state !== 'attached')
			throw new Error(`${entry.label} did not attach to ${eventChannel} (state=${channel.state})`);
		if (entry.screenId) {
			const screenChannelName = `screen:${event.id}:${entry.screenId}`;
			const screenChannel = entry.client.channels.get(screenChannelName);
			await screenChannel.subscribe(record(entry, 'screen'));
			if (screenChannel.state !== 'attached')
				throw new Error(`${entry.label} did not attach to ${screenChannelName} (state=${screenChannel.state})`);
			await screenChannel.presence.enter({ screenId: entry.screenId });
		}
	}

	// ----------------------------------------------------------------- workload
	const playoutScreen = screens[0];
	let session = await api(`/api/events/${event.id}/screens/${playoutScreen.id}/broadcast-graphics/live-session`);

	const commandId = (prefix) => {
		commandSeq += 1;
		return `${prefix}:issue189fan:${commandSeq}`;
	};

	async function send(command) {
		const result = await api(
			`/api/events/${event.id}/screens/${playoutScreen.id}/broadcast-graphics/live-sessions/${session.id}/commands`,
			{ method: 'POST', body: command },
		);
		session = result.session;
		return result;
	}

	function acceptedRevisionOf() {
		const inputs = session?.currentState?.inputs?.[graphicId];
		if (!inputs || typeof inputs.acceptedRevision !== 'number')
			throw new Error('acceptedRevision not found; the probe is reading the wrong state path');
		return inputs.acceptedRevision;
	}

	let playoutCommands = 0;
	const setInput = async (key, value) => {
		await send({ commandId: commandId(`set-${key}`), type: 'Set Input', payload: { graphicId, inputKey: key, value } });
		playoutCommands += 1;
	};

	for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
		await setInput('name', `Competitor ${cycle}`);
		await setInput('title', 'Quarterfinalist');
		await send({ commandId: commandId('take'), type: 'Take', payload: { graphicId } });
		playoutCommands += 1;
		await setInput('name', `Competitor ${cycle} Longname`);
		await setInput('title', `Seed ${cycle} — Quarterfinalist`);
		await send({ commandId: commandId('update'), type: 'Update Graphic', payload: { graphicId, basedOnAcceptedRevision: acceptedRevisionOf() } });
		playoutCommands += 1;
		await send({ commandId: commandId('out'), type: 'Out', payload: { graphicId } });
		playoutCommands += 1;
	}

	let screenCommands = 0;
	for (const screen of screens) {
		for (const command of ['refresh', 'identify']) {
			await api(`/api/events/${event.id}/screens/${screen.id}/command`, { method: 'POST', body: { command } });
			screenCommands += 1;
		}
	}

	// Delivery is asynchronous; give it room, then stop counting.
	await new Promise(done => setTimeout(done, 4000));

	// ------------------------------------------------------------------ results
	const all = clients.flatMap(entry => entry.received);
	if (all.length === 0)
		throw new Error('zero messages delivered to any subscriber — the measurement did not measure anything');

	const byType = {};
	for (const item of all) {
		byType[item.name] ??= { delivered: 0, maxBytes: 0, minBytes: Infinity };
		byType[item.name].delivered += 1;
		byType[item.name].maxBytes = Math.max(byType[item.name].maxBytes, item.bytes);
		byType[item.name].minBytes = Math.min(byType[item.name].minBytes, item.bytes);
	}

	console.log(JSON.stringify({
		origin,
		shape: {
			operatorConsoles: OPERATOR_CONSOLES,
			screenOutputs: screens.length,
			totalConnections: clients.length,
			distinctConnectionIds: new Set(connectionIds).size,
			channelsInUse: 1 + screens.length,
		},
		workload: { cycles: CYCLES, playoutCommands, screenCommands },
		perClientDelivered: (() => {
			const rows = Object.fromEntries(clients.map(e => [e.label, e.received.length]));
			if (Object.keys(rows).length !== clients.length)
				throw new Error(`client labels collided: ${clients.length} clients produced ${Object.keys(rows).length} rows`);
			return rows;
		})(),
		deliveredTotal: all.length,
		byType,
		largestDeliveredMessageBytes: Math.max(...all.map(i => i.bytes)),
	}, null, 2));

	for (const entry of clients)
		entry.client.close();
	await api(`/api/events/${event.id}`, { method: 'DELETE' }).catch(() => undefined);
	process.exit(0);
}

// Importing this module must do nothing. The unit test imports it to pin the
// refusal, and a module that provisioned an Event on import would be the very
// hazard `probeOrigin` exists to close.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
	await main();
