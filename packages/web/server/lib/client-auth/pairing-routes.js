/**
 * Client-auth pairing + device management routes (pairing v2).
 * Fork adaptation: standalone registration (not embedded in core-routes).
 */
import express from 'express';

export const registerClientAuthPairingRoutes = (app, deps) => {
  const {
    uiAuthController,
    remoteClientAuthRuntime,
    clientPairingRuntime,
    getRelayPairingCandidate = async () => null,
    reconcileRelay = async () => {},
    getPairingTransports = () => ({ local: null, lan: null, relayAvailable: true }),
    getDirectCandidateUrls = () => [],
    getServerId = async () => null,
    getServerLabel = () => 'OpenChamber',
  } = deps;

  const runWithUiAuth = async (req, res, next, handler, options = {}) => {
    try {
      const requireAuth = options.sessionOnly === true && typeof uiAuthController.requireSessionAuth === 'function'
        ? uiAuthController.requireSessionAuth
        : uiAuthController.requireAuth;
      await requireAuth(req, res, async () => {
        await handler();
      });
    } catch (error) {
      next(error);
    }
  };

  const runWithClientManagementAuth = async (req, res, next, handler) => {
    try {
      if (typeof uiAuthController.resolveAuthContext === 'function') {
        const context = await uiAuthController.resolveAuthContext(req, res, {
          allowClientAuth: true,
          allowUrlToken: false,
        });
        if (context?.type === 'session' || context?.type === 'client') {
          await handler(context);
          return;
        }
      }

      await runWithUiAuth(req, res, next, async () => {
        await handler({ type: 'session' });
      }, { sessionOnly: true });
    } catch (error) {
      next(error);
    }
  };

  const runWithClientCreateAuth = async (req, res, next, handler) => {
    try {
      if (typeof uiAuthController.resolveAuthContext === 'function') {
        const context = await uiAuthController.resolveAuthContext(req, res, {
          allowClientAuth: true,
          allowUrlToken: false,
        });
        if (context?.type === 'session') {
          await handler(context);
          return;
        }
        if (context?.type === 'client') {
          const client = await clientRecordFromAuthContext(context);
          if (client?.clientKind === 'desktop-local') {
            await handler({ ...context, client });
            return;
          }
          return res.status(403).json({ error: 'Client tokens cannot create remote clients' });
        }
      }

      await runWithUiAuth(req, res, next, async () => {
        await handler({ type: 'session' });
      }, { sessionOnly: true });
    } catch (error) {
      next(error);
    }
  };

  const clientIdFromAuthContext = (context) => {
    const raw = context?.client?.id || context?.clientId;
    return typeof raw === 'string' && raw.length > 0 ? raw : null;
  };

  const clientRecordFromAuthContext = async (context) => {
    if (context?.client && typeof context.client === 'object') {
      return context.client;
    }
    const clientId = clientIdFromAuthContext(context);
    if (!clientId) return null;
    const clients = await remoteClientAuthRuntime.listClients();
    return clients.find((client) => client.id === clientId) || null;
  };

  const requestOrigin = (req) => {
    const forwardedProto = typeof req.headers?.['x-forwarded-proto'] === 'string'
      ? req.headers['x-forwarded-proto'].split(',')[0].trim()
      : '';
    const protocol = forwardedProto || (req.socket?.encrypted ? 'https' : 'http');
    const host = typeof req.headers?.host === 'string' ? req.headers.host.trim() : '';
    if (!host) return null;
    return `${protocol}://${host}`;
  };

  const requestIp = (req) => {
    // Do not use req.ip here: Express rewrites it from X-Forwarded-For when
    // trust proxy is enabled, and redeem is unauthenticated before this limit.
    return req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown';
  };

  const pairingIdFromRequest = (req) => {
    const raw = typeof req.body?.pairingId === 'string' ? req.body.pairingId.trim() : '';
    return raw || 'missing';
  };

  const checkPairingRedeemRateLimit = (req) => {
    const now = Date.now();
    const key = `${requestIp(req)}:${pairingIdFromRequest(req)}`;
    for (const [entryKey, entry] of pairingRedeemAttempts.entries()) {
      if (!entry || now - entry.firstAttemptAt >= PAIRING_REDEEM_RATE_LIMIT_WINDOW_MS) {
        pairingRedeemAttempts.delete(entryKey);
      }
    }
    const entry = pairingRedeemAttempts.get(key);
    if (!entry) {
      pairingRedeemAttempts.set(key, { count: 1, firstAttemptAt: now });
      return { allowed: true, remaining: PAIRING_REDEEM_RATE_LIMIT_MAX_ATTEMPTS - 1, reset: Math.ceil((now + PAIRING_REDEEM_RATE_LIMIT_WINDOW_MS) / 1000) };
    }
    const reset = Math.ceil((entry.firstAttemptAt + PAIRING_REDEEM_RATE_LIMIT_WINDOW_MS) / 1000);
    if (entry.count >= PAIRING_REDEEM_RATE_LIMIT_MAX_ATTEMPTS) {
      return {
        allowed: false,
        remaining: 0,
        reset,
        retryAfter: Math.max(1, Math.ceil((entry.firstAttemptAt + PAIRING_REDEEM_RATE_LIMIT_WINDOW_MS - now) / 1000)),
      };
    }
    entry.count += 1;
    return { allowed: true, remaining: PAIRING_REDEEM_RATE_LIMIT_MAX_ATTEMPTS - entry.count, reset };
  };

  const clearPairingRedeemRateLimit = (req) => {
    pairingRedeemAttempts.delete(`${requestIp(req)}:${pairingIdFromRequest(req)}`);
  };

  const normalizeCandidateUrl = (value) => {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      const parsed = new URL(value.trim());
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
      parsed.hash = '';
      parsed.search = '';
      return parsed.toString().replace(/\/+$/, '');
    } catch {
      return null;
    }
  };

  // `preferredServerUrl` is the caller-supplied externally reachable URL (the
  // desktop UI reaches its own server over loopback, so the request origin is not
  // scannable — it passes the LAN URL instead). Falls back to the request origin
  // for remote callers where the Host header IS the reachable address.
  //
  // `includeRelay` is the per-link transport choice from the create-link dialog:
  //   true  → add the relay candidate, enabling the relay host on demand;
  //   false → direct only, never relay;
  //   undefined → legacy: advertise relay only if it is already enabled.
  // `includeDirect === false` produces a relay-only link (no direct candidate).
  const pairingServerCandidates = async (req, { preferredServerUrl, includeRelay, includeDirect = true } = {}) => {
    const candidates = [];
    if (includeDirect) {
      const direct = normalizeCandidateUrl(preferredServerUrl) || requestOrigin(req);
      if (direct) {
        let type = 'lan';
        try {
          const parsed = new URL(direct);
          type = parsed.protocol === 'https:' ? 'tunnel' : 'lan';
        } catch {
        }
        candidates.push({ type, url: direct, priority: 10 });
      }
    }
    // The client races candidates and falls back to relay only if the direct URL
    // is unreachable (relay carries a higher priority number).
    if (includeRelay !== false) {
      try {
        const relayCandidate = await getRelayPairingCandidate({ ensureEnabled: includeRelay === true });
        if (relayCandidate) candidates.push(relayCandidate);
      } catch {
        // A relay enable/status failure must not break direct pairing.
      }
    }
    return candidates;
  };

  const sendPairingRedeemError = (res, error) => {
    const statusCode = typeof error?.statusCode === 'number' ? error.statusCode : 400;
    res.status(statusCode).json({ error: 'Invalid or expired pairing session' });
  };

  
  app.get('/api/client-auth/clients', async (req, res, next) => {
    await runWithClientManagementAuth(req, res, next, async (authContext) => {
      if (authContext.type === 'client') {
        const client = await clientRecordFromAuthContext(authContext);
        // The desktop shell's local client is the trusted operator of this
        // server; it manages devices just like a browser UI session. Every
        // other client token is scoped to its own record.
        if (client?.clientKind !== 'desktop-local') {
          return res.json({ clients: client ? [client] : [] });
        }
      }
      const clients = await remoteClientAuthRuntime.listClients();
      res.json({ clients });
    });
  });

  app.post('/api/client-auth/clients', express.json({ limit: '64kb' }), async (req, res, next) => {
    await runWithClientCreateAuth(req, res, next, async () => {
      const result = await remoteClientAuthRuntime.createClient({
        label: req.body?.label,
        clientKind: req.body?.clientKind,
        dedupeKey: req.body?.dedupeKey,
      });
      res.setHeader('Cache-Control', 'no-store');
      res.status(201).json(result);
    });
  });

  app.delete('/api/client-auth/clients/:id', async (req, res, next) => {
    await runWithClientManagementAuth(req, res, next, async (authContext) => {
      if (authContext.type === 'client') {
        const actingClient = await clientRecordFromAuthContext(authContext);
        // The desktop shell's local client manages every device; other client
        // tokens may only revoke themselves.
        if (actingClient?.clientKind !== 'desktop-local') {
          const clientId = clientIdFromAuthContext(authContext);
          if (!clientId || clientId !== req.params?.id) {
            return res.status(403).json({ revoked: false, error: 'Client tokens can only revoke themselves' });
          }
        }
      }
      const result = await remoteClientAuthRuntime.revokeClient(req.params?.id);
      if (!result.revoked) {
        return res.status(404).json({ revoked: false, error: 'Client not found' });
      }
      void reconcileRelay();
      res.json(result);
    });
  });

  app.delete('/api/client-auth/clients', async (req, res, next) => {
    await runWithClientManagementAuth(req, res, next, async (authContext) => {
      if (authContext.type === 'client') {
        const actingClient = await clientRecordFromAuthContext(authContext);
        // Purging revoked devices is a whole-server management action; only the
        // trusted desktop shell client (or a UI session) may do it.
        if (actingClient?.clientKind !== 'desktop-local') {
          return res.status(403).json({ purged: 0, error: 'Client tokens cannot purge revoked devices' });
        }
      }
      const result = await remoteClientAuthRuntime.purgeRevokedClients();
      void reconcileRelay();
      res.json(result);
    });
  });

  app.post('/api/client-auth/pairing/sessions', express.json({ limit: '64kb' }), async (req, res, next) => {
    await runWithClientCreateAuth(req, res, next, async (authContext) => {
      const candidates = await pairingServerCandidates(req, {
        preferredServerUrl: req.body?.serverUrl,
        includeRelay: typeof req.body?.includeRelay === 'boolean' ? req.body.includeRelay : undefined,
        includeDirect: req.body?.includeDirect !== false,
      });
      const usesRelay = candidates.some((candidate) => candidate.type === 'relay');
      const result = await clientPairingRuntime.createPairingSession({
        label: req.body?.label,
        allowedClientKinds: req.body?.allowedClientKinds,
        createdByClientId: clientIdFromAuthContext(authContext),
        usesRelay,
      });
      void reconcileRelay();
      res.setHeader('Cache-Control', 'no-store');
      res.status(201).json({
        ...result,
        server: { label: getServerLabel(), candidates },
      });
    });
  });

  // Current reachable transports for an ALREADY-PAIRED device. Pairing-payload
  // candidates are a snapshot: when DHCP hands this machine a new address, the
  // device's saved LAN candidate goes stale and it is stuck on the relay forever.
  // A client that connected over any live transport calls this to learn the
  // server's present LAN URLs (plus the relay candidate when enabled) and update
  // its saved candidate set. `serverId` lets the client bind the response — and
  // later /health probes of the learned addresses — to this server's identity
  // before trusting them with its bearer token.
  // Auth: UI session or client bearer; never the short-lived URL token.
  app.get('/api/client-auth/connection/candidates', async (req, res, next) => {
    await runWithClientManagementAuth(req, res, next, async () => {
      const candidates = [];
      const directUrls = (() => {
        try {
          const urls = getDirectCandidateUrls(req);
          return Array.isArray(urls) ? urls : [];
        } catch {
          return [];
        }
      })();
      for (const url of directUrls) {
        const normalized = normalizeCandidateUrl(url);
        if (normalized) candidates.push({ type: 'lan', url: normalized, priority: 10 });
      }
      try {
        const relayCandidate = await getRelayPairingCandidate({ ensureEnabled: false });
        if (relayCandidate) candidates.push(relayCandidate);
      } catch {
        // Relay status failure must not break the direct-candidate refresh.
      }
      let serverId = null;
      try {
        const value = await getServerId();
        serverId = typeof value === 'string' && value.trim() ? value.trim() : null;
      } catch {
        serverId = null;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json({ label: getServerLabel(), ...(serverId ? { serverId } : {}), candidates });
    });
  });

  // Direct transports the server can be reached on (for the create-device dialog).
  app.get('/api/client-auth/pairing/transports', async (req, res, next) => {
    await runWithClientCreateAuth(req, res, next, async () => {
      res.setHeader('Cache-Control', 'no-store');
      res.json(getPairingTransports(req));
    });
  });

  // Pending pairing sessions (link created, device not yet connected) for the
  // "pending devices" list. Secrets are never included.
  app.get('/api/client-auth/pairing/sessions', async (req, res, next) => {
    await runWithClientCreateAuth(req, res, next, async () => {
      const pending = await clientPairingRuntime.listPendingSessions();
      res.setHeader('Cache-Control', 'no-store');
      res.json({ pending });
    });
  });

  app.delete('/api/client-auth/pairing/sessions/:id', async (req, res, next) => {
    await runWithClientCreateAuth(req, res, next, async () => {
      const result = await clientPairingRuntime.cancelPairingSession(req.params?.id);
      if (!result.cancelled) {
        return res.status(404).json({ cancelled: false, error: 'Pairing session not found' });
      }
      void reconcileRelay();
      res.json(result);
    });
  });

  app.post('/api/client-auth/pairing/redeem', express.json({ limit: '64kb' }), async (req, res, next) => {
    try {
      const rateLimit = checkPairingRedeemRateLimit(req);
      res.setHeader('X-RateLimit-Limit', PAIRING_REDEEM_RATE_LIMIT_MAX_ATTEMPTS);
      res.setHeader('X-RateLimit-Remaining', rateLimit.remaining);
      res.setHeader('X-RateLimit-Reset', rateLimit.reset);
      if (!rateLimit.allowed) {
        res.setHeader('Retry-After', rateLimit.retryAfter);
        return res.status(429).json({ error: 'Invalid or expired pairing session' });
      }
      const result = await clientPairingRuntime.redeemPairingSession({
        pairingId: req.body?.pairingId,
        secret: req.body?.secret,
        clientLabel: req.body?.clientLabel,
        clientKind: req.body?.clientKind,
        deviceName: req.body?.deviceName,
        devicePlatform: req.body?.devicePlatform,
        deviceModel: req.body?.deviceModel,
        appVersion: req.body?.appVersion,
        dedupeKey: req.body?.dedupeKey,
      });
      clearPairingRedeemRateLimit(req);
      // The session became a device: relay demand may have moved from the pending
      // session to the paired device (or a non-relay redeem may drop it).
      void reconcileRelay();
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        ok: true,
        server: {
          label: getServerLabel(),
          url: requestOrigin(req),
          fingerprint: result.pairing?.fingerprint || null,
        },
        client: result.client,
        clientToken: result.token,
      });
    } catch (error) {
      if (error?.message === 'Invalid or expired pairing session') {
        sendPairingRedeemError(res, error);
        return;
      }
      next(error);
    }
  });


};
