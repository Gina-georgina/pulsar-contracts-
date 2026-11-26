import errorRegistry from "../../../sdk/error-registry.json";

type ErrorRegistryEntry = {
  code: number;
  key?: string;
  message?: string;
};

type ErrorRegistry = {
  errors?: ErrorRegistryEntry[];
};

const registry = errorRegistry as ErrorRegistry;

/**
 * Data-driven map of contract error codes to i18n translation keys.
 * Built from sdk/error-registry.json so that adding a new error code
 * only requires updating the registry (and its locale entries).
 */
export const CONTRACT_ERROR_KEYS: Record<number, string> = (() => {
  const map: Record<number, string> = {};
  const entries = registry.errors ?? [];
  for (const entry of entries) {
    if (typeof entry?.code !== "number") continue;
    map[entry.code] = entry.key ?? `errors.${entry.code}`;
  }
  return map;
})();

export const UNKNOWN_ERROR_KEY = "errors.unknown";

/**
 * Returns the i18n translation key for a given contract error code.
 */
export function getErrorKey(code: number): string {
  return CONTRACT_ERROR_KEYS[code] ?? UNKNOWN_ERROR_KEY;
}

/**
 * Extracts a contract error code from an error message, if present.
 */
export function extractErrorCode(err: unknown): number | null {
  if (err instanceof Error) {
    const match = err.message.match(/Error\(Contract, #(\d+)\)/);
    if (match) {
      return parseInt(match[1], 10);
    }
  }
  return null;
}

/**
 * Returns an i18n translation key describing the given error.
 *
 * - Contract errors map to `errors.<code>` (or `errors.unknown`).
 * - Non-contract `Error` instances map to `errors.unknown`.
 * - Non-`Error` values map to `errors.unknown`.
 */
export function getErrorMessage(err: unknown): string {
  const code = extractErrorCode(err);
  if (code !== null) {
    return getErrorKey(code);
  }
  return UNKNOWN_ERROR_KEY;
}