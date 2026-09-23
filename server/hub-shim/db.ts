import { drizzle } from 'drizzle-orm/d1';
import * as schema from '../db/schema';

let _db: ReturnType<typeof drizzle<typeof schema>> | undefined;
function getDb() {
	if (!_db) {
		const binding = (process.env as any).DB || (globalThis as any).__env__?.DB || (globalThis as any).DB;
		if (!binding)
			throw new Error('DB binding not found');
		_db = drizzle(binding, { schema });
	}
	return _db;
}
export const db = new Proxy({}, { get(_, prop) { return (getDb() as any)[prop]; } }) as ReturnType<typeof getDb>;
export { schema };
