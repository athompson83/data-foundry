import { describe, expect, it } from 'vitest';
import {
  McpWorkerConfigurationError,
  resolveMcpWorkerConfig,
  type McpWorkerEnv,
} from '../src/env.js';

const queue = { send: async (): Promise<void> => undefined };

const base: McpWorkerEnv = {
  DEPLOYMENT_ENVIRONMENT: 'development',
  POSTGRES_URL: 'postgres://fixture/db',
  VERTICAL_SLUG: 'hvac',
  API_KEY_ENVIRONMENT: 'test',
  MCP_HOSTNAME: 'mcp.example.test',
  MCP_ALLOWED_ORIGINS: 'https://client.example.test,https://agents.example.test:8443',
  PUBLIC_ORIGIN: 'https://data.example.test',
  USAGE_EVENTS_QUEUE: queue,
};

describe('MCP Worker environment', () => {
  it.each([undefined, '', ' ', 'preview'])('refuses an absent, blank, or unknown deployment environment: %j', (value) => {
    expect(() => resolveMcpWorkerConfig({ ...base, DEPLOYMENT_ENVIRONMENT: value })).toThrow(
      /DEPLOYMENT_ENVIRONMENT/,
    );
  });

  it('resolves one explicit vertical, credential namespace, host, origin set, and public origin', () => {
    expect(resolveMcpWorkerConfig(base)).toEqual({
      connectionString: 'postgres://fixture/db',
      verticalSlug: 'hvac',
      apiKeyEnvironment: 'test',
      deploymentEnvironment: 'development',
      hostname: 'mcp.example.test',
      allowedOrigins: new Set([
        'https://client.example.test',
        'https://agents.example.test:8443',
      ]),
      publicOrigin: 'https://data.example.test',
    });
  });

  it.each([
    ['database', { ...base, POSTGRES_URL: undefined }],
    ['vertical', { ...base, VERTICAL_SLUG: ' ' }],
    ['credential namespace', { ...base, API_KEY_ENVIRONMENT: undefined }],
    ['host', { ...base, MCP_HOSTNAME: 'https://mcp.example.test/path' }],
    ['origins', { ...base, MCP_ALLOWED_ORIGINS: 'https://ok.test/path' }],
    ['public origin', { ...base, PUBLIC_ORIGIN: 'https://data.example.test/path' }],
  ])('refuses an invalid or absent %s', (_label, env) => {
    expect(() => resolveMcpWorkerConfig(env)).toThrow(McpWorkerConfigurationError);
  });

  it('permits HTTP only for loopback development origins', () => {
    expect(
      resolveMcpWorkerConfig({
        ...base,
        MCP_HOSTNAME: 'localhost',
        MCP_ALLOWED_ORIGINS: 'http://localhost:3000',
        PUBLIC_ORIGIN: 'http://127.0.0.1:8787',
      }).allowedOrigins,
    ).toEqual(new Set(['http://localhost:3000']));

    expect(() =>
      resolveMcpWorkerConfig({ ...base, MCP_ALLOWED_ORIGINS: 'http://client.example.test' }),
    ).toThrow(/HTTPS/);
  });

  it('requires Hyperdrive, live keys, and a Queue binding in production', () => {
    expect(() =>
      resolveMcpWorkerConfig({ ...base, DEPLOYMENT_ENVIRONMENT: 'production' }),
    ).toThrow(/HYPERDRIVE/);

    expect(() =>
      resolveMcpWorkerConfig({
        ...base,
        DEPLOYMENT_ENVIRONMENT: 'production',
        HYPERDRIVE: { connectionString: 'postgres://hyperdrive/db' },
      }),
    ).toThrow(/live/);

    expect(() =>
      resolveMcpWorkerConfig({
        ...base,
        DEPLOYMENT_ENVIRONMENT: 'production',
        HYPERDRIVE: { connectionString: 'postgres://hyperdrive/db' },
        API_KEY_ENVIRONMENT: 'live',
        USAGE_EVENTS_QUEUE: undefined,
      }),
    ).toThrow(/USAGE_EVENTS_QUEUE/);

    expect(
      resolveMcpWorkerConfig({
        ...base,
        DEPLOYMENT_ENVIRONMENT: 'production',
        HYPERDRIVE: { connectionString: 'postgres://hyperdrive/db' },
        API_KEY_ENVIRONMENT: 'live',
      }).connectionString,
    ).toBe('postgres://hyperdrive/db');
  });

  it.each([
    ['MCP hostname', { MCP_HOSTNAME: 'localhost' }],
    ['canonical MCP hostname', { MCP_HOSTNAME: 'localhost.' }],
    ['MCP hostname subdomain', { MCP_HOSTNAME: 'api.localhost.' }],
    ['IPv4 loopback MCP hostname', { MCP_HOSTNAME: '127.0.0.1' }],
    ['IPv6 loopback MCP hostname', { MCP_HOSTNAME: '[0:0:0:0:0:0:0:1]' }],
    ['IPv4-mapped IPv6 loopback MCP hostname', { MCP_HOSTNAME: '[::ffff:7f00:1]' }],
    ['unspecified MCP hostname', { MCP_HOSTNAME: '0.0.0.0' }],
    ['allowed origin', { MCP_ALLOWED_ORIGINS: 'https://127.0.0.1' }],
    ['canonical allowed origin', { MCP_ALLOWED_ORIGINS: 'https://localhost.' }],
    ['IPv4-mapped IPv6 loopback allowed origin', { MCP_ALLOWED_ORIGINS: 'https://[::ffff:7f00:1]' }],
    ['unspecified allowed origin', { MCP_ALLOWED_ORIGINS: 'https://[::]' }],
    ['public origin', { PUBLIC_ORIGIN: 'https://[::1]' }],
    ['canonical public origin', { PUBLIC_ORIGIN: 'https://localhost.' }],
    ['IPv4-mapped IPv6 loopback public origin', { PUBLIC_ORIGIN: 'https://[::ffff:7f00:1]' }],
    ['unspecified public origin', { PUBLIC_ORIGIN: 'https://0.0.0.0' }],
  ] as const)('refuses a loopback or unspecified production %s', (_label, override) => {
    expect(() =>
      resolveMcpWorkerConfig({
        ...base,
        ...override,
        DEPLOYMENT_ENVIRONMENT: 'production',
        HYPERDRIVE: { connectionString: 'postgres://hyperdrive/db' },
        API_KEY_ENVIRONMENT: 'live',
      }),
    ).toThrow(/loopback/i);
  });
});
