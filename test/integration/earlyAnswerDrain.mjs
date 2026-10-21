import http from 'node:http';

/**
 * Read to its end a request body that was answered before it arrived (#633).
 *
 * A route may answer without reading what was sent: a multipart part the library
 * already holds is the one CI hit. Under `nuxt dev`, Nitro's dev proxy (httpxy)
 * pipes the request into its hop to the dev worker, and once the worker has
 * answered that pipe stops: the rest of the body sits unread on the public
 * listener's connection, which Node keeps alive because the response finished.
 * A client that has written its whole body by then may send its next request on
 * that connection; it waits behind the unread bytes until the listener's
 * keep-alive timeout (5 s plus Node's 1 s buffer) resets it, 6 s after the early
 * answer, with nothing logged. A multipart `complete` died that way in CI with
 * `read ECONNRESET` after 5932 ms, 67 ms after the duplicate part's answer.
 *
 * Node already reads and discards a body nobody started reading (`req._dump()`
 * when a response finishes); this does the same for one somebody stopped
 * forwarding, so the connection stays usable and the next request is answered.
 * Only the integration servers run it (`./integrationServerPreload.mjs`); a
 * deployed Worker is not served by `nuxt dev`.
 *
 * Imports only Node built-ins, so `test/unit/integration/earlyAnswerDrain.test.ts`
 * can pin it without a server. Returns the function that restores what it patched.
 *
 * @returns {() => void} the uninstaller
 */
export function installEarlyAnswerDrain() {
	const serverEmit = http.Server.prototype.emit;
	/**
	 * @this {http.Server}
	 * @param {string | symbol} event
	 * @param {any[]} args
	 */
	http.Server.prototype.emit = function (event, ...args) {
		if (event === 'request') {
			/** @type {[http.IncomingMessage, http.ServerResponse]} */
			const [request, response] = /** @type {any} */ (args);
			response.once('finish', () => {
				if (request.complete || request.destroyed)
					return;
				request.unpipe();
				request.resume();
			});
		}
		return serverEmit.call(this, event, ...args);
	};
	return () => {
		http.Server.prototype.emit = serverEmit;
	};
}
