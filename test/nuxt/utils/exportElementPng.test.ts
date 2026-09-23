import { describe, expect, it, vi } from 'vitest';
import {
	inlineExportFontSources,
	inlineExportImageSources,
	inlineExportStyleUrls,
	waitForElementExportReadiness,
} from '~/utils/exportElementPng';

describe('waitForElementExportReadiness', () => {
	it('waits for an asynchronously mounted renderer to announce readiness', async () => {
		const element = document.createElement('div');
		document.body.appendChild(element);
		const ready = waitForElementExportReadiness(element, { timeoutMs: 1000 });
		let settled = false;
		void ready.then(() => {
			settled = true;
		});
		await Promise.resolve();
		expect(settled).toBe(false);

		const marker = document.createElement('div');
		marker.dataset.exportReady = 'true';
		element.appendChild(marker);

		await expect(ready).resolves.toBeUndefined();
		element.remove();
	});

	it('waits for export-ready markers to clear', async () => {
		const element = document.createElement('div');
		const marker = document.createElement('div');
		marker.dataset.exportReady = 'false';
		element.appendChild(marker);
		document.body.appendChild(element);

		const ready = waitForElementExportReadiness(element, { timeoutMs: 1000 });
		await Promise.resolve();
		marker.dataset.exportReady = 'true';

		await expect(ready).resolves.toBeUndefined();
		element.remove();
	});

	it('waits for image decode hooks', async () => {
		const element = document.createElement('div');
		const image = document.createElement('img');
		image.src = 'https://example.test/logo.png';
		Object.defineProperty(image, 'complete', { configurable: true, value: false });
		Object.defineProperty(image, 'decode', { configurable: true, value: vi.fn().mockResolvedValue(undefined) });
		element.appendChild(image);
		document.body.appendChild(element);

		await waitForElementExportReadiness(element, { timeoutMs: 1000 });

		expect(image.decode).toHaveBeenCalledOnce();
		element.remove();
	});
});

describe('inlineExportImageSources', () => {
	it('embeds HTML and SVG image bytes so the export canvas stays origin-clean', async () => {
		const source = document.createElement('div');
		source.innerHTML = `
			<img src="https://cards.example/card.png" srcset="https://cards.example/card@2x.png 2x">
			<svg><image href="https://cards.example/card.png"></image></svg>
		`;
		const target = source.cloneNode(true) as HTMLElement;
		vi.stubGlobal('fetch', vi.fn(async () => new Response(
			new Uint8Array([1, 2, 3]),
			{ status: 200, headers: { 'content-type': 'image/png' } },
		)));

		await inlineExportImageSources(source, target);

		const htmlImage = target.querySelector('img')!;
		const svgImage = target.querySelector('svg image')!;
		expect(htmlImage.src).toBe('data:image/png;base64,AQID');
		expect(htmlImage.hasAttribute('srcset')).toBe(false);
		expect(svgImage.getAttribute('href')).toBe('data:image/png;base64,AQID');
		expect(fetch).toHaveBeenCalledOnce();
		vi.unstubAllGlobals();
	});
});

describe('inlineExportStyleUrls', () => {
	it('embeds external style resources while preserving local SVG references', async () => {
		const element = document.createElement('div');
		element.setAttribute(
			'style',
			`background-image:url("https://assets.example/background.png");mask-image:url("#local-mask");`,
		);
		vi.stubGlobal('fetch', vi.fn(async () => new Response(
			new Uint8Array([1, 2, 3]),
			{ status: 200, headers: { 'content-type': 'image/png' } },
		)));

		await inlineExportStyleUrls(element);

		expect(element.getAttribute('style')).toContain('data:image/png;base64,AQID');
		expect(element.getAttribute('style')).toContain('url("#local-mask")');
		expect(fetch).toHaveBeenCalledOnce();
		vi.unstubAllGlobals();
	});
});

describe('inlineExportFontSources', () => {
	it('defines asset-backed font families from embedded revision bytes', async () => {
		const element = document.createElement('div');
		const text = document.createElement('p');
		text.dataset.exportFontSources = JSON.stringify([{
			family: 'stream-keepr-asset-font',
			url: '/screen-output/screens/4/assets/font/revisions/1/content',
		}]);
		element.appendChild(text);
		vi.stubGlobal('fetch', vi.fn(async () => new Response(
			new Uint8Array([1, 2, 3]),
			{ status: 200, headers: { 'content-type': 'font/woff2' } },
		)));

		await inlineExportFontSources(element);

		expect(element.querySelector('style')?.textContent).toContain(
			'@font-face{font-family:"stream-keepr-asset-font";src:url("data:font/woff2;base64,AQID")}',
		);
		expect(text.hasAttribute('data-export-font-sources')).toBe(false);
		expect(fetch).toHaveBeenCalledOnce();
		vi.unstubAllGlobals();
	});
});
