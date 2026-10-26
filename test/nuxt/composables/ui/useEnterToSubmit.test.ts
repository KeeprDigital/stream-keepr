import type { EffectScope } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, ref } from 'vue';

describe('useEnterToSubmit', () => {
	function fireKeydown(key: string, target: EventTarget = document) {
		const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
		target.dispatchEvent(event);
		return event;
	}

	let attached: HTMLElement[] = [];
	let scopes: EffectScope[] = [];

	/** A target inside `html`'s outermost element, attached to the document. */
	function targetIn(html: string) {
		const host = document.createElement('div');
		host.innerHTML = html;
		document.body.appendChild(host);
		attached.push(host);
		return host.querySelector('[data-target]') ?? host.firstElementChild!;
	}

	function register(callback: () => void, options?: Parameters<typeof useEnterToSubmit>[1]) {
		const scope = effectScope();
		scopes.push(scope);
		scope.run(() => useEnterToSubmit(callback, options));
		return scope;
	}

	beforeEach(() => {
		attached = [];
		scopes = [];
	});

	afterEach(() => {
		for (const scope of scopes) scope.stop();
		for (const el of attached) el.remove();
	});

	it('calls the callback on Enter and claims the key', () => {
		const cb = vi.fn();
		register(cb);

		const event = fireKeydown('Enter');

		expect(cb).toHaveBeenCalledOnce();
		expect(event.defaultPrevented).toBe(true);
	});

	it('ignores other keys', () => {
		const cb = vi.fn();
		register(cb);

		fireKeydown('Escape');

		expect(cb).not.toHaveBeenCalled();
	});

	it.each([
		['a textarea', '<textarea></textarea>'],
		['a button', '<button></button>'],
		['a role=button element', '<div role="button"></div>'],
		['a link', '<a href="#x"></a>'],
		['editable content', '<div contenteditable="true"></div>'],
		['an opted-out region', '<div data-enter-submit-ignore><input data-target></div>'],
		['an open listbox', '<div role="listbox"><div data-target></div></div>'],
		['a menu', '<div role="menu"><div data-target></div></div>'],
		['a combobox', '<div role="combobox"></div>'],
	])('leaves Enter alone inside %s', (_, html) => {
		const cb = vi.fn();
		register(cb);

		const event = fireKeydown('Enter', targetIn(html));

		expect(cb).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(false);
	});

	it('answers Enter from an input or an unguarded role', () => {
		const cb = vi.fn();
		register(cb);

		fireKeydown('Enter', targetIn('<input>'));
		fireKeydown('Enter', targetIn('<div role="dialog"><div data-target></div></div>'));

		expect(cb).toHaveBeenCalledTimes(2);
	});

	it('stays quiet while disabled, and answers once enabled', () => {
		const cb = vi.fn();
		const disabled = ref(true);
		register(cb, { disabled });

		fireKeydown('Enter');
		disabled.value = false;
		fireKeydown('Enter');

		expect(cb).toHaveBeenCalledOnce();
	});

	it('fires only the most recently registered instance of a stack', () => {
		const lower = vi.fn();
		const upper = vi.fn();
		register(lower);
		register(upper);

		fireKeydown('Enter');

		expect(upper).toHaveBeenCalledOnce();
		expect(lower).not.toHaveBeenCalled();
	});

	it('passes Enter down the stack while the top instance is disabled', () => {
		const lower = vi.fn();
		const upper = vi.fn();
		register(lower);
		register(upper, { disabled: true });

		fireKeydown('Enter');

		expect(lower).toHaveBeenCalledOnce();
		expect(upper).not.toHaveBeenCalled();
	});

	it('hands Enter back to the instance beneath once the top one is disposed', () => {
		const lower = vi.fn();
		const upper = vi.fn();
		register(lower);
		const top = register(upper);

		top.stop();
		fireKeydown('Enter');

		expect(lower).toHaveBeenCalledOnce();
		expect(upper).not.toHaveBeenCalled();
	});
});
