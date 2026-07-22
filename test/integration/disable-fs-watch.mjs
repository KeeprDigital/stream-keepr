import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import process from 'node:process';

// These integration-only warnings happen during Nuxt test server boot before
// Cloudflare dev bindings settle, or when Nuxt starts an internal websocket
// probe twice. The assertions still exercise the real D1-backed API paths.
const ignoredIntegrationWarningPatterns = [
	'[nuxt:hub] Failed to create migrations table',
	'[nuxt-hub] DB binding not found',
	'WebSocket server error: Port 24678 is already in use',
];

function createNoopWatcher() {
	const watcher = new EventEmitter();
	watcher.close = () => {};
	watcher.ref = () => watcher;
	watcher.unref = () => watcher;
	return watcher;
}

function chunkText(chunk, encoding) {
	if (typeof chunk === 'string')
		return chunk;

	if (chunk instanceof Uint8Array)
		return Buffer.from(chunk).toString(typeof encoding === 'string' ? encoding : 'utf8');

	return '';
}

const writeStderr = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, encoding, callback) => {
	if (ignoredIntegrationWarningPatterns.some(pattern => chunkText(chunk, encoding).includes(pattern))) {
		if (typeof encoding === 'function')
			encoding();
		else if (typeof callback === 'function')
			callback();

		return true;
	}

	return writeStderr(chunk, encoding, callback);
};

fs.watch = createNoopWatcher;
syncBuiltinESMExports();
