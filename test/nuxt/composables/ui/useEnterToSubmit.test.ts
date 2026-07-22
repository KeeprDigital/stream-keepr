import type { EffectScope } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';

describe('useEnterToSubmit', () => {
	/** Dispatch a KeyboardEvent from the given target (defaults to document). */
	function fireKeydown(key: string, target: EventTarget = document) {
		const event = new KeyboardEvent('keydown', { key, bubbles: true });
		target.dispatchEvent(event);
	}

	/** Elements appended during a test so we can clean them up. */
	let attached: HTMLElement[] = [];

	function attachElement(el: HTMLElement): HTMLElement {
		document.body.appendChild(el);
		attached.push(el);
		return el;
	}

	/** Shared scope — stopped after each test to clean up listeners + stack. */
	let scope: EffectScope;

	beforeEach(() => {
		scope = effectScope();
		vi.clearAllMocks();
	});

	afterEach(() => {
		scope.stop();
		for (const el of attached) el.remove();
		attached = [];
	});

	// ── Basic behaviour ──

	it('calls callback on Enter', () => {
		const cb = vi.fn();
		scope.run(() => useEnterToSubmit(cb));
		fireKeydown('Enter');
		expect(cb).toHaveBeenCalledOnce();
	});

	// ── Disabled option ──

	// ── Textarea guard ──

	// ── ARIA role guards ──

	it('calls callback when target is inside a role that is not guarded', () => {
		const cb = vi.fn();
		scope.run(() => useEnterToSubmit(cb));

		const container = document.createElement('div');
		container.setAttribute('role', 'dialog');
		const child = document.createElement('div');
		container.appendChild(child);
		attachElement(container);

		fireKeydown('Enter', child);
		expect(cb).toHaveBeenCalledOnce();
	});

	// ── Cleanup ──

	// ── Stacking ──
});
