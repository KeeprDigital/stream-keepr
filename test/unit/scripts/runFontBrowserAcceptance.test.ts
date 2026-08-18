import { describe, expect, it, vi } from 'vitest';
import {
	observeChromiumVerdict,
	serveAcceptanceRoutes,
} from '../../../scripts/graphics-acceptance/chromium.mjs';
import { runAcceptanceHarness } from '../../../scripts/graphics-acceptance/harness.mjs';
import {
	acceptanceOrigin,
	openInstallation,
	stageFontIngestion,
} from '../../../scripts/graphics-acceptance/installation.mjs';
import { main } from '../../../scripts/run-font-browser-acceptance.mjs';

vi.mock('../../../scripts/graphics-acceptance/harness.mjs', () => ({
	runAcceptanceHarness: vi.fn(),
}));

// Only what opens sockets or drives a browser is replaced; the pure helpers
// (`authoredPageRequest` among them) stay real, so these tests observe what the
// run actually hands the browser rather than which helper assembled it.
vi.mock('../../../scripts/graphics-acceptance/chromium.mjs', async importOriginal => ({
	...await importOriginal<object>(),
	observeChromiumVerdict: vi.fn(),
	serveAcceptanceRoutes: vi.fn(),
}));
vi.mock('../../../scripts/graphics-acceptance/installation.mjs', async importOriginal => ({
	...await importOriginal<object>(),
	acceptanceOrigin: vi.fn(),
	openInstallation: vi.fn(),
	stageFontIngestion: vi.fn(),
}));

const ORIGIN = 'https://stream.example.workers.dev';
const COOKIE = 'stream_keepr_graphics_author_session=3f9c1a72-5d84-4e21-9b6f-0a7c2e8d41b5';
/** The operator session #396 put beside the author cookie; both are secrets. */
const SESSION_COOKIE = '__Secure-better-auth.session_token=0f8b1c2d3e4f5a6b.7c8d9e0f1a2b3c4d';

/** Shaped like `openInstallation`'s session; only identity matters here. */
function fakeSession() {
	return {
		origin: ORIGIN,
		authorCookie: COOKIE,
		sessionCookies: [SESSION_COOKIE],
		request: vi.fn(),
		json: vi.fn(),
	};
}

/**
 * The whole context `runAcceptanceHarness` hands a run, as recording fakes.
 * Only `evidence.addSecret` and `record` matter to these pins; the rest exists
 * so the fake answers the harness's full contract.
 */
function harnessContext() {
	return {
		evidence: { addSecret: vi.fn(), report: vi.fn(), passed: vi.fn(), deferred: vi.fn() },
		record: vi.fn(),
		note: vi.fn(),
		defer: vi.fn(),
		checks: () => 0,
		failed: () => false,
	};
}

/**
 * The run the harness is handed, captured through the mocked boundary. Until
 * #345 the module ran this at import, so the two facts pinned here — the
 * session is registered as a secret before anything can print it, and the page
 * travels to the browser paired with the session that staged its operation
 * (#276) — were held only as mutation survivors with a docblock explaining why
 * no test could reach them.
 */
async function capturedRun(argv: string[]) {
	await main(['node', 'scripts/run-font-browser-acceptance.mjs', ...argv]);
	return vi.mocked(runAcceptanceHarness).mock.calls[0]![0].run;
}

describe('the font acceptance run', () => {
	it('registers both credentials as secrets and hands the browser the page paired with them', async () => {
		const session = fakeSession();
		vi.mocked(acceptanceOrigin).mockReturnValue(ORIGIN);
		vi.mocked(openInstallation).mockResolvedValue(session);
		const staged = {
			operationId: 'gio-acceptance-1',
			challenge: { glyph: 'A' },
			publishedAssetId: vi.fn().mockResolvedValue('gaa-acceptance-1'),
			dispose: vi.fn(),
		};
		vi.mocked(stageFontIngestion).mockResolvedValue(staged);
		vi.mocked(observeChromiumVerdict).mockResolvedValue({ outcome: 'passed' });
		const { evidence, record, ...rest } = harnessContext();

		const run = await capturedRun(['--library']);
		await run({ evidence, record, ...rest });

		// Registered before the ingestion is staged: from the staging call on, both
		// cookies are in flight, so a failure there must already print them masked.
		// Both, because #396 added the second and a run that registered one of two
		// would print a live session token the first time a request failed.
		expect(evidence.addSecret).toHaveBeenCalledWith(COOKIE);
		expect(evidence.addSecret).toHaveBeenCalledWith(SESSION_COOKIE);
		expect(evidence.addSecret.mock.invocationCallOrder[0]!)
			.toBeLessThan(vi.mocked(stageFontIngestion).mock.invocationCallOrder[0]!);

		// One object: the staged operation is a 404 to every session but this one
		// (ADR-0003) and every library route is a 401 without the operator session
		// (#396), so the URL and the identities reading it are inseparable.
		expect(observeChromiumVerdict).toHaveBeenCalledWith({
			url: `${ORIGIN}/_acceptance/static-font-v1.html?operation=gio-acceptance-1`,
			cookies: [SESSION_COOKIE, COOKIE],
		});

		expect(record).toHaveBeenCalledWith([]);
		// The published face is a real asset in a real installation.
		expect(staged.dispose).toHaveBeenCalledWith('gaa-acceptance-1');
	});

	it('gives the loopback run no author identity, because it reads no library route', async () => {
		const local = { origin: 'http://127.0.0.1:41234', close: vi.fn() };
		vi.mocked(serveAcceptanceRoutes).mockResolvedValue(local);
		vi.mocked(observeChromiumVerdict).mockResolvedValue({ outcome: 'passed' });
		const { evidence, ...rest } = harnessContext();

		const run = await capturedRun([]);
		await run({ evidence, ...rest });

		expect(openInstallation).not.toHaveBeenCalled();
		expect(evidence.addSecret).not.toHaveBeenCalled();
		expect(observeChromiumVerdict).toHaveBeenCalledWith({
			url: `${local.origin}/_acceptance/static-font-v1.html`,
		});
		expect(local.close).toHaveBeenCalled();
	});
});
