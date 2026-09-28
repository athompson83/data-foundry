/**
 * A D1 stand-in over Node's built-in SQLite, so tests run the real migration
 * and the real SQL (including FTS5 and RETURNING) instead of a mock.
 */

import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import type { D1Database, D1PreparedStatement, D1Result, R2Bucket } from '../src/env.js';

class Statement implements D1PreparedStatement {
  constructor(private readonly db: DatabaseSync, readonly sql: string, readonly values: ReadonlyArray<string | number | null> = []) {}

  bind(...values: ReadonlyArray<string | number | null>): D1PreparedStatement {
    return new Statement(this.db, this.sql, values);
  }

  async first<T>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...(this.values as SQLInputValue[]));
    return (row as T | undefined) ?? null;
  }

  async all<T>(): Promise<D1Result<T>> {
    return { results: this.db.prepare(this.sql).all(...(this.values as SQLInputValue[])) as T[] };
  }

  async run(): Promise<unknown> {
    return this.db.prepare(this.sql).run(...(this.values as SQLInputValue[]));
  }
}

export function createTestDatabase(): { db: D1Database; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(':memory:');
  for (const migration of ['0001_init.sql', '0002_raw_in_r2.sql', '0003_product_recalls.sql', '0004_extraction_intake.sql']) {
    sqlite.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'));
  }
  const db: D1Database = {
    prepare: (sql) => new Statement(sqlite, sql),
    async batch(statements) {
      // D1 batches are transactions.
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { db, sqlite };
}

export function createTestBucket(): R2Bucket & { objects: Map<string, string> } {
  const objects = new Map<string, string>();
  return {
    objects,
    async put(key, value) {
      objects.set(key, value);
      return {};
    },
    async get(key, options) {
      const value = objects.get(key);
      if (value === undefined) return null;
      const bytes = new TextEncoder().encode(value);
      const slice = options?.range ? bytes.slice(options.range.offset, options.range.offset + options.range.length) : bytes;
      return { text: async () => new TextDecoder().decode(slice) };
    },
  };
}
