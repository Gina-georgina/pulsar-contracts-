'use strict';

const { randomUUID } = require('crypto');

const REQUEST_ID_HEADER = 'X-Request-ID';

/**
 * Validates that a candidate request ID is a non-empty, reasonably sized string.
 * Guards against header injection / log pollution from untrusted clients.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isValidRequestId(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 128 &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}

/**
 * Extracts a request ID from an incoming request, accepting it from the
 * X-Request-ID header (case-insensitive) or from an already-populated req.id.
 *
 * @param {import('http').IncomingMessage} req
 * @returns {string|null}
 */
function extractRequestId(req) {
  if (!req) {
    return null;
  }

  if (isValidRequestId(req.id)) {
    return req.id;
  }

  let headerValue = null;

  if (req.headers && typeof req.headers === 'object') {
    headerValue =
      req.headers['x-request-id'] ||
      req.headers['X-Request-ID'] ||
      req.headers['x-request-id'.toLowerCase()];
  }

  if (Array.isArray(headerValue)) {
    headerValue = headerValue[0];
  }

  if (isValidRequestId(headerValue)) {
    return headerValue;
  }

  return null;
}

/**
 * Generates a new request ID (UUID v4).
 *
 * @returns {string}
 */
function generateRequestId() {
  return randomUUID();
}

/**
 * Resolves the request ID for a request: reuse an incoming one if valid,
 * otherwise generate a fresh UUID.
 *
 * @param {import('http').IncomingMessage} req
 * @returns {string}
 */
function resolveRequestId(req) {
  return extractRequestId(req) || generateRequestId();
}

/**
 * Returns the request ID associated with the given request object, if any.
 * Useful for downstream service calls that need to propagate the ID.
 *
 * @param {import('http').IncomingMessage} [req]
 * @returns {string|undefined}
 */
function getRequestId(req) {
  if (!req) {
    return undefined;
  }
  return req.id || undefined;
}

/**
 * Builds headers for a downstream call, propagating the current request ID.
 *
 * @param {import('http').IncomingMessage} [req]
 * @param {Object<string, string>} [extraHeaders]
 * @returns {Object<string, string>}
 */
function getPropagationHeaders(req, extraHeaders) {
  const headers = Object.assign({}, extraHeaders || {});
  const id = getRequestId(req);
  if (id) {
    headers[REQUEST_ID_HEADER] = id;
  }
  return headers;
}

/**
 * Creates a logger bound to a request ID. Falls back to the provided base
 * logger (e.g. console or a structured logger) when available.
 *
 * @param {string} requestId
 * @param {Object} [baseLogger]
 * @returns {{ info: Function, warn: Function, error: Function, debug: Function, child: Function, requestId: string }}
 */
function createRequestLogger(requestId, baseLogger) {
  const base = baseLogger || console;

  const emit = (level, args) => {
    const fn =
      typeof base[level] === 'function'
        ? base[level].bind(base)
        : (base.log ? base.log.bind(base) : console[level].bind(console));

    // Prefer structured logging when the base logger supports it.
    if (typeof base.child === 'function') {
      const child = base.child({ requestId });
      const childFn =
        typeof child[level] === 'function'
          ? child[level].bind(child)
          : child.info.bind(child);
      childFn(...args);
      return;
    }

    fn(...args, { requestId });
  };

  const logger = {
    requestId,
    info: (...args) => emit('info', args),
    warn: (...args) => emit('warn', args),
    error: (...args) => emit('error', args),
    debug: (...args) => emit('debug', args),
    child: (bindings) =>
      createRequestLogger(requestId, {
        child: (extra) =>
          typeof base.child === 'function'
            ? base.child(Object.assign({ requestId }, bindings, extra))
            : {
                info: (...a) => emit('info', a),
                warn: (...a) => emit('warn', a),
                error: (...a) => emit('error', a),
                debug: (...a) => emit('debug', a),
              },
      }),
  };

  return logger;
}

/**
 * Express/Connect-compatible middleware that:
 *  - generates or accepts an X-Request-ID (UUID),
 *  - attaches it to req.id,
 *  - sets the X-Request-ID response header,
 *  - attaches a request-scoped logger to req.log.
 *
 * @param {Object} [options]
 * @param {Object} [options.logger] Base logger to bind request IDs to.
 * @param {string} [options.header] Header name to use (defaults to X-Request-ID).
 * @returns {Function}
 */
function requestIdMiddleware(options) {
  const opts = options || {};
  const headerName = opts.header || REQUEST_ID_HEADER;
  const baseLogger = opts.logger;

  return function requestId(req, res, next) {
    const id = resolveRequestId(req);

    req.id = id;
    req.requestId = id;
    req.log = createRequestLogger(id, baseLogger);

    if (res && typeof res.setHeader === 'function') {
      res.setHeader(headerName, id);
    }

    if (typeof next === 'function') {
      next();
    }
  };
}

module.exports = requestIdMiddleware;
module.exports.requestIdMiddleware = requestIdMiddleware;
module.exports.getRequestId = getRequestId;
module.exports.getPropagationHeaders = getPropagationHeaders;
module.exports.generateRequestId = generateRequestId;
module.exports.resolveRequestId = resolveRequestId;
module.exports.createRequestLogger = createRequestLogger;
module.exports.isValidRequestId = isValidRequestId;
module.exports.REQUEST_ID_HEADER = REQUEST_ID_HEADER;