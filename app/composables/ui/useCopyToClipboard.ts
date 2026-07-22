interface CopyToClipboardFeedback {
	successTitle?: string;
	successDescription?: string;
	errorTitle?: string;
	errorDescription?: string;
}

export function useCopyToClipboard() {
	const toast = useToast();
	const { copy, copied, isSupported } = useClipboard({ legacy: true });

	async function copyToClipboard(value: MaybeRefOrGetter<string>, feedback: CopyToClipboardFeedback = {}) {
		const text = toValue(value);

		if (!text) {
			toast.add({
				title: feedback.errorTitle ?? 'Copy failed',
				description: feedback.errorDescription ?? 'There was nothing to copy.',
				color: 'error',
			});
			return false;
		}

		if (!isSupported.value) {
			toast.add({
				title: feedback.errorTitle ?? 'Copy failed',
				description: 'Clipboard access is not available in this browser.',
				color: 'error',
			});
			return false;
		}

		try {
			await copy(text);
			toast.add({
				title: feedback.successTitle ?? 'Copied',
				description: feedback.successDescription ?? 'Copied to clipboard.',
				color: 'success',
			});
			return true;
		}
		catch (error) {
			console.error('Failed to copy to clipboard:', error);
			toast.add({
				title: feedback.errorTitle ?? 'Copy failed',
				description: feedback.errorDescription ?? 'Unable to copy to clipboard.',
				color: 'error',
			});
			return false;
		}
	}

	return {
		copyToClipboard,
		copied,
		isClipboardSupported: isSupported,
	};
}
