import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getErrorMessage, getErrorTranslationKey } from './contractErrors';

const __dirname = dirname(fileURLToPath(import.meta.url));

function findFile(startDir: string, relativePath: string): string | null {
  let current = startDir;
  for (let i = 0; i < 10; i++) {
    const candidate = resolve(current, relativePath);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

function loadErrorRegistry(): Record<string, unknown> {
  const registryPath = findFile(__dirname, 'sdk/error-registry.json');
  if (!registryPath) {
    throw new Error('Could not locate sdk/error-registry.json');
  }
  return JSON.parse(readFileSync(registryPath, 'utf-8'));
}

function loadLocale(): Record<string, unknown> {
  const localePath = findFile(__dirname, 'src/i18n/locales/en.json');
  if (!localePath) {
    throw new Error('Could not locate src/i18n/locales/en.json');
  }
  return JSON.parse(readFileSync(localePath, 'utf-8'));
}

function getNestedValue(obj: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object' && part in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, obj);
}

function extractErrorCodes(registry: Record<string, unknown>): string[] {
  const codes: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (typeof record.code === 'string') {
        codes.push(record.code);
      }
      Object.values(record).forEach(visit);
    }
  };
  visit(registry);
  return Array.from(new Set(codes));
}

describe('contractErrors', () => {
  const registry = loadErrorRegistry();
  const locale = loadLocale();
  const errorCodes = extractErrorCodes(registry);

  it('loads error codes from the registry', () => {
    expect(errorCodes.length).toBeGreaterThan(0);
  });

  it('has a translation key for every error code in the registry', () => {
    const missing: string[] = [];
    for (const code of errorCodes) {
      const translationKey = getErrorTranslationKey(code);
      const value = getNestedValue(locale, translationKey);
      if (typeof value !== 'string' || value.length === 0) {
        missing.push(`${code} -> ${translationKey}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('returns the expected translation key for a known code', () => {
    const knownCode = errorCodes[0];
    const translationKey = getErrorTranslationKey(knownCode);
    expect(translationKey).toBe(`errors.contract.${knownCode}`);
    expect(getErrorMessage(knownCode)).toBe(translationKey);
  });

  it('returns the fallback translation key for an unknown code', () => {
    const unknownCode = '__UNKNOWN_ERROR_CODE__';
    expect(getErrorTranslationKey(unknownCode)).toBe('errors.contract.unknown');
    expect(getErrorMessage(unknownCode)).toBe('errors.contract.unknown');
  });
});