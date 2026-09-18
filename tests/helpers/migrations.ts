import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'migrations';

// Every .sql file in order, so a new migration reaches the test schema without touching each test file.
export const migrationFiles = (): string[] => readdirSync(DIR).filter((name) => name.endsWith('.sql')).sort();

export function applyMigrations(db: { exec: (sql: string) => unknown }): void {
  for (const name of migrationFiles()) db.exec(readFileSync(join(DIR, name), 'utf8'));
}
