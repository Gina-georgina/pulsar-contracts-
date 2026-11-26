import { rpc, xdr } from "@stellar/stellar-sdk";
import { randomUUID } from "crypto";
import { allWebhooks } from "./store";
import { deliver, WebhookPayload } from "./deliver";

const WATCHED_EVENTS = new Set([
  "payment_processed",
  "payment_archived",
  "refund_initiated",
  "refund_approved",
  "refund_rejected",
  "refund_executed",
  "multisig_initiated",
  "multisig_signed",
  "multisig_executed",
]);

const MAX_CONSECUTIVE_FAILURES = 3;

export interface ListenerOptions {
  /** Override the RPC server (used for testing). */
  server?: rpc.Server;
  /** Called when the RPC has been unreachable for more than 3 consecutive polls. */
  onAlert?: (message: string, details: { rpcUrl: string; failures: number }) => void;
}

function defaultAlert(
  message: string,
  details: { rpcUrl: string; failures: number }
): void {
  console.error(
    `[listener] ALERT: ${message} (rpcUrl=${details.rpcUrl}, consecutiveFailures=${details.failures})`
  );
}

export async function startListener(
  rpcUrl: string,
  contractId: string,
  pollIntervalMs = 5_000,
  options: ListenerOptions = {}
): Promise<void> {
  const server = options.server ?? new rpc.Server(rpcUrl);
  const alert = options.onAlert ?? defaultAlert;
  let latestLedger = 0;
  let consecutiveFailures = 0;
  let alertFired = false;

  console.log(`[listener] Watching contract ${contractId} on ${rpcUrl}`);

  const timer = setInterval(async () => {
    try {
      const info = await server.getLatestLedger();

      // Successful poll: reset circuit-breaker state.
      if (consecutiveFailures > 0) {
        console.log(
          `[listener] RPC recovered after ${consecutiveFailures} consecutive failure(s)`
        );
      }
      consecutiveFailures = 0;
      alertFired = false;

      if (info.sequence <= latestLedger) return;

      const events = await server.getEvents({
        startLedger: latestLedger || info.sequence - 1,
        filters: [{ type: "contract", contractIds: [contractId] }],
      });

      latestLedger = info.sequence;

      for (const ev of events.events) {
        const topic = ev.topic[0];
        if (!topic) continue;

        let eventName: string;
        try {
          const scVal = topic;
          const strVal = scVal.str();
          eventName = typeof strVal === "string" ? strVal : strVal.toString();
        } catch {
          continue;
        }

        if (!WATCHED_EVENTS.has(eventName)) continue;

        const payload: WebhookPayload = {
          event: eventName,
          contractId,
          ledger: ev.ledger,
          timestamp: ev.ledgerClosedAt
            ? Math.floor(new Date(ev.ledgerClosedAt).getTime() / 1000)
            : Math.floor(Date.now() / 1000),
          data: { id: ev.id, value: ev.value },
        };

        // Determine merchant address from event data when available
        const merchantAddress = extractMerchant(ev);
        const hooks = allWebhooks().filter(
          (h) => !merchantAddress || h.merchantAddress === merchantAddress
        );

        for (const hook of hooks) {
          deliver(hook.url, payload, requestId).catch(() => {});
        }
      }
    } catch (err) {
      consecutiveFailures += 1;
      console.error(
        `[listener] Poll error (consecutiveFailures=${consecutiveFailures}):`,
        err
      );

      if (consecutiveFailures > MAX_CONSECUTIVE_FAILURES && !alertFired) {
        alertFired = true;
        alert(
          `RPC unreachable for ${consecutiveFailures} consecutive polls`,
          { rpcUrl, failures: consecutiveFailures }
        );
      }
    }
  }, pollIntervalMs);

  return {
    stop() {
      clearInterval(timer);
    },
  };
}

function extractMerchant(ev: rpc.Api.EventResponse): string | null {
  try {
    // topic[1] is conventionally the merchant address in Pulsar events
    const raw = ev.topic[1];
    if (!raw) return null;
    const addressVal = raw.address();
    return typeof addressVal === "string" ? addressVal : addressVal.toString();
  } catch {
    return null;
  }
}
