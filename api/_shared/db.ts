import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema.js';

type NeonSql = ReturnType<typeof neon>;

let sqlClient: NeonSql | null = null;
let dbClient: unknown | null = null;

export function hasDatabaseUrl(): boolean {
  return Boolean(process.env['DATABASE_URL']);
}

export function getSql(): NeonSql {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is not configured.');
  if (!sqlClient) sqlClient = neon(url);
  return sqlClient;
}

export function getDb() {
  if (!dbClient) dbClient = drizzle(getSql(), { schema });
  return dbClient;
}

export async function query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const sql = getSql();
  return (await sql.query(text, params)) as T[];
}
