import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createOpenCodeGoCredentialStore } from './opencode-go-credentials.js';
import { registerQuotaRoutes } from './routes.js';

let dataDir;
let credentials;

beforeAll(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-go-routes-'));
  credentials = createOpenCodeGoCredentialStore({ dataDir });
});

afterAll(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('OpenCode Go credential routes', () => {
  test('rejects legacy cookie credential writes when no compatibility validator is installed', async () => {
    const app = express();
    registerQuotaRoutes(app, {
      getQuotaProviders: async () => ({}),
      openCodeGoCredentials: credentials,
    });

    await request(app)
      .put('/api/quota/credentials/opencode-go')
      .send({ workspaceId: 'wrk_test', authCookie: 'secret' })
      .expect(410);
  });

  test('validates and stores a normalized credential without returning the secret', async () => {
    const app = express();
    registerQuotaRoutes(app, {
      getQuotaProviders: async () => ({}),
      openCodeGoCredentials: credentials,
      validateOpenCodeGoCredential: async () => ({}),
    });

    const response = await request(app)
      .put('/api/quota/credentials/opencode-go')
      .send({ workspaceId: ' wrk_test ', authCookie: ' auth=secret ' })
      .expect(200);

    expect(response.body).toEqual({
      configured: true,
      workspaceId: 'wrk_test',
      secretMasked: '********',
    });
    expect(response.body).not.toHaveProperty('authCookie');
    expect(credentials.read()).toEqual({ workspaceId: 'wrk_test', authCookie: 'secret' });
  });
});
