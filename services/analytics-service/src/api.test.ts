import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from './api';

describe('analytics API authentication', () => {
  const validKey = 'test-analytics-key';
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    process.env.ANALYTICS_API_KEYS = validKey;
    app = createApp();
  });

  afterEach(() => {
    delete process.env.ANALYTICS_API_KEYS;
  });

  it('returns 401 when no Authorization header is provided', async () => {
    const res = await request(app).get('/analytics/revenue');
    expect(res.status).toBe(401);
  });

  it('returns 401 when the Authorization header is not a Bearer token', async () => {
    const res = await request(app)
      .get('/analytics/revenue')
      .set('Authorization', 'Basic abc123');
    expect(res.status).toBe(401);
  });

  it('returns 403 when the API key is invalid', async () => {
    const res = await request(app)
      .get('/analytics/revenue')
      .set('Authorization', 'Bearer wrong-key');
    expect(res.status).toBe(403);
  });

  it('allows access with a valid API key', async () => {
    const res = await request(app)
      .get('/analytics/revenue')
      .set('Authorization', `Bearer ${validKey}`);
    expect(res.status).toBe(200);
  });

  it('protects every analytics route', async () => {
    const routes = ['/analytics/revenue', '/analytics/top-merchants', '/analytics/customer-segments'];
    for (const route of routes) {
      const unauth = await request(app).get(route);
      expect(unauth.status).toBe(401);

      const auth = await request(app)
        .get(route)
        .set('Authorization', `Bearer ${validKey}`);
      expect(auth.status).toBe(200);
    }
  });
});
