type EChartsTheme = Record<string, unknown>;

interface ThemeTokens {
	background: string;
	backgroundElevated: string;
	border: string;
	borderMuted: string;
	text: string;
	textMuted: string;
	palette: string[];
}

function resolveToken(tokenName: string, fallback: string): string {
	if (import.meta.client) {
		const value = getComputedStyle(document.documentElement).getPropertyValue(tokenName).trim();
		if (value)
			return value;
	}

	return fallback;
}

function resolveThemeTokens(isDark: boolean): ThemeTokens {
	return {
		background: resolveToken('--ui-bg', isDark ? '#111827' : '#ffffff'),
		backgroundElevated: resolveToken('--ui-bg-elevated', isDark ? '#1f2937' : '#f9fafb'),
		border: resolveToken('--ui-border', isDark ? '#374151' : '#e5e7eb'),
		borderMuted: resolveToken('--ui-border-muted', isDark ? 'rgba(107, 114, 128, 0.45)' : 'rgba(156, 163, 175, 0.35)'),
		text: resolveToken('--ui-text', isDark ? '#f3f4f6' : '#111827'),
		textMuted: resolveToken('--ui-text-muted', isDark ? '#9ca3af' : '#6b7280'),
		palette: [
			resolveToken('--ui-primary', '#3b82f6'),
			resolveToken('--ui-color-success', '#22c55e'),
			resolveToken('--ui-color-info', '#06b6d4'),
			resolveToken('--ui-color-warning', '#f59e0b'),
			resolveToken('--ui-color-error', '#ef4444'),
			resolveToken('--ui-color-neutral-400', '#94a3b8'),
			resolveToken('--ui-primary-400', '#60a5fa'),
			resolveToken('--ui-primary-300', '#93c5fd'),
			resolveToken('--ui-color-neutral-500', '#64748b'),
			resolveToken('--ui-color-neutral-300', '#cbd5e1'),
		],
	};
}

export function useEChartsTheme() {
	const colorMode = useColorMode();

	return computed<EChartsTheme>(() => {
		const tokens = resolveThemeTokens(colorMode.value === 'dark');

		const axisTheme = {
			axisLine: {
				lineStyle: {
					color: tokens.borderMuted,
				},
			},
			axisTick: {
				lineStyle: {
					color: tokens.borderMuted,
				},
			},
			axisLabel: {
				color: tokens.textMuted,
			},
			nameTextStyle: {
				color: tokens.textMuted,
			},
			splitLine: {
				lineStyle: {
					color: tokens.borderMuted,
				},
			},
		};

		return {
			color: tokens.palette,
			backgroundColor: tokens.background,
			textStyle: {
				color: tokens.text,
			},
			title: {
				textStyle: {
					color: tokens.text,
				},
				subtextStyle: {
					color: tokens.textMuted,
				},
			},
			legend: {
				textStyle: {
					color: tokens.textMuted,
				},
				pageTextStyle: {
					color: tokens.textMuted,
				},
				inactiveColor: tokens.border,
				pageIconColor: tokens.textMuted,
				pageIconInactiveColor: tokens.border,
			},
			tooltip: {
				backgroundColor: tokens.backgroundElevated,
				borderColor: tokens.border,
				textStyle: {
					color: tokens.text,
				},
				extraCssText: 'box-shadow: none; border-radius: 8px;',
			},
			categoryAxis: axisTheme,
			valueAxis: axisTheme,
			timeAxis: axisTheme,
			logAxis: axisTheme,
			pie: {
				itemStyle: {
					borderColor: tokens.background,
					borderWidth: 2,
				},
				label: {
					color: tokens.text,
				},
				labelLine: {
					lineStyle: {
						color: tokens.borderMuted,
					},
				},
			},
		};
	});
}
