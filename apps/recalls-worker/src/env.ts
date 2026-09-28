/**
 * The narrow slice of the Workers binding surface this Worker uses, declared
 * locally as the other apps do rather than pulling in the full platform types.
 */

export interface D1Result<T> {
  readonly results: T[];
}

export interface D1PreparedStatement {
  bind(...values: ReadonlyArray<string | number | null>): D1PreparedStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<D1Result<T>>;
  run(): Promise<unknown>;
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
}

export interface R2Bucket {
  put(key: string, value: string, options?: {
    httpMetadata?: { contentType?: string };
    customMetadata?: Record<string, string>;
  }): Promise<unknown>;
  get(key: string, options?: { range?: { offset: number; length: number } }): Promise<{ text(): Promise<string> } | null>;
}

export interface Env {
  readonly DB: D1Database;
  readonly RAW_ARTIFACTS: R2Bucket;
  /** "1" stops acquisition and data serving immediately (rights kill switch). */
  readonly SOURCE_KILL_SWITCH?: string;
  /** "1" stops acquisition and serving of the CPSC/Health Canada product-recall dataset (its rights kill switch). */
  readonly PRODUCT_RECALLS_KILL_SWITCH?: string;
  /** "1" serves the product-recall dataset (API and pages); anything else keeps it private while it loads. */
  readonly PRODUCT_RECALLS_OPEN?: string;
  /** "1" accepts new checkouts; anything else shows an opening-soon page. */
  readonly SALES_OPEN?: string;
  readonly STRIPE_SECRET_KEY?: string;
  readonly STRIPE_WEBHOOK_SECRET?: string;
  readonly STRIPE_PRICE_EVALUATE?: string;
  readonly STRIPE_PRICE_DEVELOPER?: string;
  readonly STRIPE_PRICE_GROWTH?: string;
  readonly STRIPE_PRICE_SCALE?: string;
  /** "1" opens the RapidAPI channel (ADR-0016); it also needs RAPIDAPI_PROXY_SECRET. */
  readonly RAPIDAPI_ENABLED?: string;
  /** The listing's X-RapidAPI-Proxy-Secret (a Worker secret). */
  readonly RAPIDAPI_PROXY_SECRET?: string;
  /** Bearer token for the operator-only /admin endpoints. */
  readonly ADMIN_TOKEN?: string;
  readonly PUBLIC_ORIGIN?: string;
  readonly API_ORIGIN?: string;
  readonly SUPPORT_EMAIL?: string;
  /** Public IndexNow key, served at /<key>.txt; unset disables pings. */
  readonly INDEXNOW_KEY?: string;
}
