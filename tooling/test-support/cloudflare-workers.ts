/**
 * Node-only stand-in for the Cloudflare RPC base class.
 *
 * The production module remains `cloudflare:workers`; Vitest resolves that
 * module to this file solely so target Worker modules can be imported locally.
 */
export abstract class WorkerEntrypoint<Env = unknown> {
  protected readonly env: Env;

  constructor(_ctx: unknown, env: Env) {
    this.env = env;
  }
}
