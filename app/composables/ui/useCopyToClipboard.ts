interface CopyToClipboardFeedback {
	successTitle?: string;
	successDescription?: string;
	/**
	 * What to say when the caller handed over nothing.
	 *
	 * Only the caller knows why it had nothing, and on the Screen surfaces the reason
	 * is load-bearing: the empty string means asset access was refused, and an operator
	 * told "copy failed" reaches for the address in their browser's bar — the
	 * media-losing URL the refusal exists to withhold (#231, #250).
	 *
	 * There is deliberately no override for the other failure. The clipboard refusing
	 * a write is this composable's fact, not the caller's, and a caller allowed to
	 * name it would necessarily be naming it wrong (#257).
	 */
	nothingToCopyTitle?: string;
	nothingToCopyDescription?: string;
}

/**
 * Writes through the Clipboard API first and the legacy `execCommand` after, and
 * **reads what the legacy write answered**.
 *
 * That last clause is the whole reason this is hand-rolled rather than VueUse's
 * `useClipboard`. In VueUse 14.3.0 a denied Clipboard API write is caught and routed
 * into its own `legacyCopy`, which calls `document.execCommand('copy')` and discards
 * the boolean; `copy()` then sets `copied` true and resolves regardless. A successful
 * copy and a failed one leave that seam byte-for-byte identical, so no amount of
 * reading its refs recovers the difference — and the caller toasted "URL Copied"
 * having copied nothing (#257). `isSupported` was no better: `legacy: true` forces it
 * true, so the unsupported branch it guarded could never run.
 *
 * `copy()` guards only its Clipboard API write; `legacyCopy` is called outside that
 * try, so a throwing `execCommand` propagated out of `copy()` — which is what the old
 * composable's catch branch was there for, and the one copy failure it could see.
 * Bringing the call in here brings that obligation with it, so the legacy write is
 * wrapped rather than merely observed: escaping this function would mean an unhandled
 * rejection and no report at all.
 *
 * The Clipboard API is tried first because it is the one that works without a user
 * gesture in the current task; the legacy path is kept because a page served over
 * plain http — an ordinary way to reach this app on a venue LAN — has no
 * `navigator.clipboard` at all.
 */
async function writeToClipboard(text: string): Promise<boolean> {
	try {
		if (navigator.clipboard) {
			await navigator.clipboard.writeText(text);
			return true;
		}
	}
	catch {
		// A refused Clipboard API write is the common case for a page without focus or
		// transient activation, and the legacy write frequently succeeds where it does.
		// Falling through is not swallowing the failure: the legacy write is observed.
	}

	const textarea = document.createElement('textarea');
	textarea.value = text;
	textarea.style.position = 'absolute';
	textarea.style.opacity = '0';
	textarea.setAttribute('readonly', '');
	try {
		document.body.appendChild(textarea);
		textarea.select();
		return document.execCommand('copy');
	}
	catch (error) {
		// `execCommand` is long deprecated, so a browser that has removed it throws here
		// rather than answering false. Logged because an exception on this path is a fact
		// about the browser rather than about the copy, and reported as a failed write
		// because from the operator's side that is exactly what it is.
		console.error('Failed to copy to clipboard:', error);
		return false;
	}
	finally {
		textarea.remove();
	}
}

export function useCopyToClipboard() {
	const toast = useToast();

	/**
	 * Copies text and tells the operator which of the two things that can go wrong did.
	 *
	 * They are not variants of one failure. "There was nothing to hand over" is about
	 * the value, and its reason belongs to whoever produced it; "the clipboard would
	 * not take it" is about this browser, and the only thing to do about that is to
	 * copy the text by hand. One error pair covering both meant a caller that named one
	 * necessarily mis-named the other (#257).
	 */
	async function copyToClipboard(value: MaybeRefOrGetter<string>, feedback: CopyToClipboardFeedback = {}) {
		const text = toValue(value);

		if (!text) {
			toast.add({
				title: feedback.nothingToCopyTitle ?? 'Nothing copied',
				description: feedback.nothingToCopyDescription ?? 'There was nothing to copy.',
				color: 'error',
			});
			return false;
		}

		if (!await writeToClipboard(text)) {
			toast.add({
				title: 'Copy failed',
				description: 'This browser would not let the page write to the clipboard, so nothing was copied. Select the text and copy it by hand.',
				color: 'error',
			});
			return false;
		}

		toast.add({
			title: feedback.successTitle ?? 'Copied',
			description: feedback.successDescription ?? 'Copied to clipboard.',
			color: 'success',
		});
		return true;
	}

	return { copyToClipboard };
}
