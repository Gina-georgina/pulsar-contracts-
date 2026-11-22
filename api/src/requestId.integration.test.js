'use strict';

const request = require('supertest');
const express = require('express');
const { v4: uuidv4, validate: uuidValidate } = require('uuid');

const {
  requestIdMiddleware,
  REQUEST_ID_HEADER,
} = require('./middleware/requestId');

describe('X-Request-ID integration', () => {
  let app;
  let downstreamCalls;

  beforeEach(() => {
    downstreamCalls = [];
    app = express();
    app.use(requestIdMiddleware);

    // Simulated downstream service call that captures the propagated header.
    const callDownstream = (req) => {
      const headers = {
        [REQUEST_ID_HEADER]: req.headers[REQUEST_ID_HEADER],
      };
      downstreamCalls.push(headers);
      return headers;
    };

    app.get('/api/payments/:id', (req, res) => {
      const downstreamHeaders = callDownstream(req);
      res.status(200).json({
        paymentId: req.params.id,
        requestId: req.id,
        downstream: downstreamHeaders,
      });
    });

    app.get('/api/error', (req, res) => {
      callDownstream(req);
      res.status(500).json({ error: 'boom', requestId: req.id });
    });
  });

  test('generates an X-Request-ID when none is provided', async () => {
    const res = await request(app).get('/api/payments/123');

    expect(res.status).toBe(200);
    expect(res.headers[REQUEST_ID_HEADER.toLowerCase()]).toBeDefined();
    expect(uuidValidate(res.headers[REQUEST_ID_HEADER.toLowerCase()])).toBe(
      true,
    );
  });

  test('returns the X-Request-ID in the response body and header', async () => {
    const res = await request(app).get('/api/payments/123');

    const headerValue = res.headers[REQUEST_ID_HEADER.toLowerCase()];
    expect(headerValue).toBeDefined();
    expect(res.body.requestId).toBe(headerValue);
  });

  test('propagates the X-Request-ID to downstream calls', async () => {
    const res = await request(app).get('/api/payments/123');

    const headerValue = res.headers[REQUEST_ID_HEADER.toLowerCase()];
    expect(downstreamCalls).toHaveLength(1);
    expect(downstreamCalls[0][REQUEST_ID_HEADER]).toBe(headerValue);
    expect(res.body.downstream[REQUEST_ID_HEADER]).toBe(headerValue);
  });

  test('preserves an incoming X-Request-ID from the client', async () => {
    const incomingId = uuidv4();

    const res = await request(app)
      .get('/api/payments/123')
      .set(REQUEST_ID_HEADER, incomingId);

    expect(res.headers[REQUEST_ID_HEADER.toLowerCase()]).toBe(incomingId);
    expect(res.body.requestId).toBe(incomingId);
    expect(downstreamCalls[0][REQUEST_ID_HEADER]).toBe(incomingId);
  });

  test('returns the X-Request-ID even on error responses', async () => {
    const res = await request(app).get('/api/error');

    expect(res.status).toBe(500);
    const headerValue = res.headers[REQUEST_ID_HEADER.toLowerCase()];
    expect(headerValue).toBeDefined();
    expect(uuidValidate(headerValue)).toBe(true);
    expect(res.body.requestId).toBe(headerValue);
    expect(downstreamCalls[0][REQUEST_ID_HEADER]).toBe(headerValue);
  });

  test('uses a distinct X-Request-ID per request', async () => {
    const first = await request(app).get('/api/payments/1');
    const second = await request(app).get('/api/payments/2');

    const firstId = first.headers[REQUEST_ID_HEADER.toLowerCase()];
    const secondId = second.headers[REQUEST_ID_HEADER.toLowerCase()];

    expect(firstId).not.toBe(secondId);
  });
});