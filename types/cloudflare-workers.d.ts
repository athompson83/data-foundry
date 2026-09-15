/**
 * Minimal Cloudflare runtime surface used by the private-canary RPC entrypoints.
 *
 * Production resolves this module in the Workers runtime. Vitest aliases it to
 * a local shim so Node never attempts to open a browser or emulate Cloudflare.
 */
declare module 'cloudflare:workers' {
  export abstract class WorkerEntrypoint<Env = unknown> {
    protected env: Env;
  }
}
