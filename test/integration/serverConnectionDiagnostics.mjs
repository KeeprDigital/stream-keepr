import http from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import workerThreads, { isMainThread, threadId } from 'node:worker_threads';

/**
 * One line for each connection an integration server drops (#633).
 *
 * A multipart `complete` once failed with `read ECONNRESET` after 5.9 s, and its
 * server's log held nothing for that test. Nothing in `nuxt dev` logs a socket it
 * destroys: not the public listener, not Nitro's proxy to its dev worker, not the
 * worker's own server. `integrationServerEnv` (`./helpers.ts`) preloads this
 * module into every server, so those events reach the server's log file and
 * `./requestLedgerReport.ts` prints them under a failed test.
 *
 * What a line carries is bounded and safe to print: the method and path without
 * its query (a Screen Output capability travels in one), the elapsed time, and a
 * Node error's code and message. Never a header or a body.
 *
 * Imports only Node built-ins, so `test/unit/integration/serverConnectionDiagnostics.test.ts`
 * can pin it without a server.
 */

const PREFIX = '[integration-server]';
/**
 * What a server's `NODE_OPTIONS` passes to `--require`: the integration server
 * preload, which installs this module and `./earlyAnswerDrain.mjs`. `--require`
 * rather than `--import`, because a Worker's `execArgv` honours only the first.
 */
export const PRELOAD_PATH = fileURLToPath(new URL('./integrationServerPreload.mjs', import.meta.url));
const MESSAGE_CHARACTERS = 200;
/** How often a thread checks that its event loop is turning, and the gap worth a line. */
const STALL_SAMPLE_MILLISECONDS = 250;
const STALL_MILLISECONDS = 1_000;

/** Where this line was written from: `nuxt dev`'s own thread, or Nitro's dev worker. */
function threadLabel() {
	return isMainThread ? 'main thread' : `worker thread ${threadId}`;
}

/** @param {string | undefined} url */
function pathOf(url) {
	return (url ?? '').split('?', 1)[0] || '/';
}

/** @param {NodeJS.ErrnoException} error */
function describeError(error) {
	return [error.code, error.message].filter(Boolean).join(': ');
}

/**
 * Call `onStall` with the gap whenever this thread's event loop went
 * `STALL_MILLISECONDS` or more without turning. Returns the function that stops it.
 *
 * @param {(milliseconds: number) => void} onStall
 * @returns {() => void} the stopper
 */
export function monitorEventLoopStalls(onStall) {
	let lastTick = Date.now();
	const monitor = setInterval(() => {
		const now = Date.now();
		const gap = now - lastTick;
		lastTick = now;
		if (gap >= STALL_MILLISECONDS)
			onStall(gap);
	}, STALL_SAMPLE_MILLISECONDS);
	monitor.unref();
	return () => clearInterval(monitor);
}

/**
 * Patch `http.Server` so every server this process creates reports what it drops.
 *
 * Returns the function that restores what it patched.
 *
 * @param {{ write?: (line: string) => void, announce?: boolean }} [options]
 * @returns {() => void} the uninstaller
 */
export function installServerConnectionDiagnostics(options = {}) {
	const write = options.write ?? (line => process.stderr.write(`${line}\n`));
	/** @param {string} event */
	const report = event => write(`${PREFIX} ${new Date().toISOString()} ${threadLabel()}: ${event.slice(0, MESSAGE_CHARACTERS)}`);
	// Once, at startup: so a log without lines from here says the connections
	// were fine, not that this was never loaded. A worker thread's start is
	// announced by the thread that started it, below.
	if (options.announce && isMainThread)
		report(`connection diagnostics installed (pid ${process.pid})`);

	/** @type {WeakMap<import('node:net').Socket, { inFlight: number, lastResponse?: { label: string, finishedAt: number } }>} */
	const connections = new WeakMap();

	/**
	 * @param {http.IncomingMessage} request
	 * @param {http.ServerResponse} response
	 */
	function watchRequest(request, response) {
		const startedAt = Date.now();
		const label = `${request.method} ${pathOf(request.url)}`;
		const elapsed = () => `${Date.now() - startedAt}ms`;
		const socket = request.socket;
		/** @type {string | undefined} */
		let socketError;
		const onTimeout = () => report(`${label}: socket timed out after ${elapsed()} with the request in flight`);
		/** @param {NodeJS.ErrnoException} error */
		const onError = (error) => {
			socketError ??= describeError(error);
		};
		const connection = connections.get(socket);
		if (connection)
			connection.inFlight++;
		socket.on('timeout', onTimeout);
		socket.on('error', onError);
		response.once('close', () => {
			socket.off('timeout', onTimeout);
			socket.off('error', onError);
			if (connection) {
				connection.inFlight--;
				connection.lastResponse = { label, finishedAt: Date.now() };
			}
			if (!response.writableFinished)
				report(`${label}: connection closed after ${elapsed()} before the response finished${socketError ? ` (${socketError})` : ''}`);
		});
	}

	/**
	 * The public listener's own keep-alive timeout (5 s plus Node's 1 s buffer)
	 * should never close a connection: the test client drops an idle one well
	 * before that. When it does, a request the client sent on it may never have
	 * been read, which is a reset nothing else here would see. Nitro's proxy
	 * leaves its connections to the dev worker idle for good, so the worker's
	 * own timeouts are routine and not written.
	 *
	 * @param {import('node:net').Socket} socket
	 */
	function watchConnection(socket) {
		const connection = { inFlight: 0 };
		connections.set(socket, connection);
		if (!isMainThread)
			return;
		socket.on('timeout', () => {
			const { inFlight, lastResponse } = /** @type {{ inFlight: number, lastResponse?: { label: string, finishedAt: number } }} */ (connection);
			if (inFlight === 0 && lastResponse)
				report(`keep-alive connection closed by its timeout ${Date.now() - lastResponse.finishedAt}ms after its last response (${lastResponse.label})`);
		});
	}

	const serverEmit = http.Server.prototype.emit;
	/**
	 * @this {http.Server}
	 * @param {string | symbol} event
	 * @param {any[]} args
	 */
	http.Server.prototype.emit = function (event, ...args) {
		if (event === 'connection')
			watchConnection(args[0]);
		else if (event === 'request')
			watchRequest(args[0], args[1]);
		return serverEmit.call(this, event, ...args);
	};

	/**
	 * Where an outgoing request went: a socket path's file name (Nitro's dev
	 * worker listens on one), or the address it connected to.
	 *
	 * @param {http.ClientRequest & { socketPath?: string }} request
	 * @param {import('node:net').Socket} socket
	 */
	function targetOf(request, socket) {
		if (request.socketPath)
			return `unix:${request.socketPath.split(/[\\/]/).at(-1)}`;
		const port = socket.remotePort ?? '';
		return `${socket.remoteAddress ?? request.host}:${port}`;
	}

	/** @type {WeakMap<http.ClientRequest, { startedAt: number, target: string, reported: boolean, answered: boolean }>} */
	const outgoingRequests = new WeakMap();

	/**
	 * @param {http.ClientRequest} request
	 * @param {import('node:net').Socket} socket
	 */
	function watchOutgoing(request, socket) {
		if (outgoingRequests.has(request))
			return;
		const state = { startedAt: Date.now(), target: request.host, reported: false, answered: false };
		outgoingRequests.set(request, state);
		const learnTarget = () => {
			state.target = targetOf(request, socket);
		};
		if (socket.remotePort === undefined && !(/** @type {any} */ (request).socketPath))
			socket.once('connect', learnTarget);
		else
			learnTarget();
	}

	/**
	 * @param {http.ClientRequest} request
	 * @param {string} event
	 */
	function reportOutgoing(request, event) {
		const state = outgoingRequests.get(request);
		if (!state || state.reported)
			return;
		state.reported = true;
		report(`outgoing ${request.method} ${state.target}${pathOf(request.path)}: ${event.replace('{elapsed}', `${Date.now() - state.startedAt}ms`)}`);
	}

	const clientEmit = http.ClientRequest.prototype.emit;
	/**
	 * @this {http.ClientRequest}
	 * @param {string | symbol} event
	 * @param {any[]} args
	 */
	http.ClientRequest.prototype.emit = function (event, ...args) {
		if (event === 'socket') {
			watchOutgoing(this, args[0]);
		}
		else if (event === 'error') {
			// After a whole answer, a failure is only the rest of a body the far end
			// no longer wanted (`./earlyAnswerDrain.mjs`), and the exchange is done.
			if (!outgoingRequests.get(this)?.answered)
				reportOutgoing(this, `failed after {elapsed} (${describeError(args[0])})`);
		}
		else if (event === 'response') {
			/** @type {http.IncomingMessage} */
			const response = args[0];
			response.once('end', () => {
				const state = outgoingRequests.get(this);
				if (state)
					state.answered = true;
			});
			response.once('close', () => {
				if (!response.complete)
					reportOutgoing(this, `response ${response.statusCode} ended after {elapsed} before it completed`);
			});
		}
		return clientEmit.call(this, event, ...args);
	};

	// Nitro serves the app from a worker thread, which a preload does not reach
	// by itself: each new Worker is given this module too, and its exit, which
	// is how a dev worker reload or crash shows, is written from here.
	const OriginalWorker = workerThreads.Worker;
	class DiagnosedWorker extends OriginalWorker {
		/**
		 * @param {string | URL} filename
		 * @param {import('node:worker_threads').WorkerOptions} [workerOptions]
		 */
		constructor(filename, workerOptions = {}) {
			const execArgv = workerOptions.execArgv ?? process.execArgv;
			const preload = `--require=${PRELOAD_PATH}`;
			super(filename, {
				...workerOptions,
				execArgv: execArgv.includes(preload) ? execArgv : [...execArgv, preload],
			});
			const id = this.threadId;
			report(`started worker thread ${id} (${workerOptions.eval ? 'eval' : String(filename).split(/[\\/]/).slice(-2).join('/')})`);
			this.once('exit', code => report(`worker thread ${id} exited with code ${code}`));
		}
	}
	workerThreads.Worker = DiagnosedWorker;
	syncBuiltinESMExports();

	// A thread that stops turning answers nothing meanwhile, and a stall the
	// length of a failed request tells "the server was stuck" from "the
	// connection was dropped".
	const stopStallMonitor = monitorEventLoopStalls(gap => report(`event loop stalled for ${gap}ms`));

	return () => {
		stopStallMonitor();
		http.Server.prototype.emit = serverEmit;
		http.ClientRequest.prototype.emit = clientEmit;
		workerThreads.Worker = OriginalWorker;
		syncBuiltinESMExports();
	};
}
