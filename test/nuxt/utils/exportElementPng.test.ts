import { describe, expect, it, vi } from 'vitest';
import { waitForElementExportReadiness } from '~/utils/exportElementPng';

describe('waitForElementExportReadiness', () => {
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
