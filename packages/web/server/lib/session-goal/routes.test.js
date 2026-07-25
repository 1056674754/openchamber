import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { getSessionGoalsCapability, registerSessionGoalRoutes, SESSION_GOALS_API_VERSION } from './routes.js';

describe('session-goal routes capability', () => {
  it('advertises goals capability', async () => {
    const app = express();
    registerSessionGoalRoutes(app);

    const response = await request(app).get('/api/goals/capability').expect(200);
    expect(response.body).toEqual({
      goals: true,
      apiVersion: SESSION_GOALS_API_VERSION,
    });
    expect(getSessionGoalsCapability()).toEqual(response.body);
  });
});
