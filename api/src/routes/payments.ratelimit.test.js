const request = require('supertest');

// Use a low limit so the test runs quickly.
process.env.RATE_LIMIT_PAYMENTS_RPM = '3';

// Mock the payment service so requests don't hit the Soroban network.
jest.mock('../services/paymentService', () => ({
  submitPayment: jest.fn().mockResolvedValue({
    id: 'test-payment-id',
    status: 'submitted',
  }),
}));

const app = require('../app');

describe('POST /api/payments rate limiting', () => {
  const limit = parseInt(process.env.RATE_LIMIT_PAYMENTS_RPM, 10);

  const validPayload = {
    sourceAccount: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    destinationAccount: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    amount: '10',
    asset: 'XLM',
  };

  it(`allows up to ${limit} requests per minute and returns 429 with Retry-After beyond that`, async () => {
    // Send requests up to the limit; these should not be rate limited.
    for (let i = 0; i < limit; i += 1) {
      const res = await request(app)
        .post('/api/payments')
        .set('X-Forwarded-For', '203.0.113.10')
        .send(validPayload);

      expect(res.status).not.toBe(429);
    }

    // The next request should exceed the limit.
    const limitedRes = await request(app)
      .post('/api/payments')
      .set('X-Forwarded-For', '203.0.113.10')
      .send(validPayload);

    expect(limitedRes.status).toBe(429);
    expect(limitedRes.headers['retry-after']).toBeDefined();
    expect(Number(limitedRes.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('applies the limit per IP', async () => {
    // Exhaust the limit for one IP.
    for (let i = 0; i < limit; i += 1) {
      await request(app)
        .post('/api/payments')
        .set('X-Forwarded-For', '198.51.100.20')
        .send(validPayload);
    }

    const blockedRes = await request(app)
      .post('/api/payments')
      .set('X-Forwarded-For', '198.51.100.20')
      .send(validPayload);

    expect(blockedRes.status).toBe(429);

    // A different IP should still be allowed.
    const otherIpRes = await request(app)
      .post('/api/payments')
      .set('X-Forwarded-For', '198.51.100.21')
      .send(validPayload);

    expect(otherIpRes.status).not.toBe(429);
  });
});