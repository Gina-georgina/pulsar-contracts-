import { Request, Response, NextFunction } from 'express';

/**
 * API-key authentication middleware for the analytics service.
 *
 * Valid keys are supplied via the ANALYTICS_API_KEYS environment variable
 * (comma-separated) or a secrets manager that populates the same variable.
 *
 * Behaviour:
 *  - 401 when no `Authorization: Bearer <key>` header is provided
 *  - 403 when the provided key is not in the allow-list
 */
export function loadApiKeys(): string[] {
  const raw = process.env.ANALYTICS_API_KEYS ?? '';
  return raw
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key.length > 0);
}

function extractBearerToken(header: string | undefined): string | null {
  if (!header) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) {
    return null;
  }
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

export function requireApiKey(validKeys: string[] = loadApiKeys()) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = extractBearerToken(req.headers.authorization);

    if (!token) {
      res.status(401).json({ error: 'Unauthorized', message: 'Missing API key' });
      return;
    }

    if (!validKeys.includes(token)) {
      res.status(403).json({ error: 'Forbidden', message: 'Invalid API key' });
      return;
    }

    next();
  };
}

export default requireApiKey;
