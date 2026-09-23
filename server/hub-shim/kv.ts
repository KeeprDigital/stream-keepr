import { createStorage } from 'unstorage';
import driver from 'unstorage/drivers/cloudflare-kv-binding';

export const kv = createStorage({ driver: driver({ binding: 'KV' }) });
