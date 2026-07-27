import type { GraphicsAssetCatalogue } from '.';

export function createD1GraphicsAssetCatalogue(database: D1Database): GraphicsAssetCatalogue {
	return {
		async checkHealth() {
			const result = await database
				.prepare('SELECT 1 AS healthy FROM graphic_assets LIMIT 1')
				.all<{ healthy: number }>();
			if (!result.success)
				throw new Error('Graphics Asset catalogue health query failed');
			return { outcome: 'healthy' };
		},
	};
}
