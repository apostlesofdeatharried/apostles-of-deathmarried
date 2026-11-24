import app from '../server.js';
import { ensureCloudDatabaseRestored, isSupabaseConfigured } from '../server/cloudSync.js';

export default async function handler(req: any, res: any) {
  if (isSupabaseConfigured()) {
    await ensureCloudDatabaseRestored();
  }
  return app(req, res);
}
