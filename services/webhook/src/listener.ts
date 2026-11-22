import { rpc, xdr } from "@stellar/stellar-sdk";
import { randomUUID } from "crypto";
import { allWebhooks } from "./store";
import { deliver, WebhookPayload } from "./deliver";

const WATCHED_EVENTS = new Set([
  "payment_processed",
  "refund_initiated",
  "refund_approved",
  "refund_rejected",
  "refund_executed",
  "multisig_initiated",
  "multisig_signed",
  "multisig_executed",
]);

export async function startListener(
  rpcUrl: string,
  contractId: string,
  pollIntervalMs = 5_000
): Promise<void> {
  const server = new rpc.Server(rpcUrl);
  let latestLedger = 0;

  console.log(`[listener] Watching contract ${contractId} on ${rpcUrl}`);

  setInterval(async () => {
    // Correlation ID shared by every webhook delivery triggered in this cycle
    const requestId = randomUUID();
    try {
      const info = await server.getLatestLedger();
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
      console.error(`[listener] Poll error (requestId=${requestId}):`, err);
    }
  }, pollIntervalMs);
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
