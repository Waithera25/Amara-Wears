import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { verifyAndSettle } from "../_shared/paystack.ts";

async function digest(secret: string, raw: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const result = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  return Array.from(result, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function secureEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function authenticated(req: Request, raw: string): Promise<boolean> {
  const modern = req.headers.get("Paystack-Signature");
  const signingSecret = Deno.env.get("PAYSTACK_WEBHOOK_SECRET");
  if (modern && signingSecret) {
    const fields = modern.split(",").map((s) => s.trim());
    const stamp = fields.find((s) => s.startsWith("t="))?.slice(2);
    if (!stamp || !/^\d+$/.test(stamp) || Math.abs(Date.now() / 1000 - Number(stamp)) > 300) return false;
    const signature = await digest(signingSecret, `${stamp}.${raw}`);
    for (const field of fields.filter((s) => s.startsWith("v1="))) {
      const value = field.slice(3).split(":");
      if (value.length === 2 && /^whk_[A-Za-z0-9]+$/.test(value[0]) &&
          /^[0-9a-f]{128}$/.test(value[1]) && secureEquals(value[1], signature)) return true;
    }
    return false;
  }
  // Legacy Paystack signatures are supported until the signing-secret mode is enabled.
  const legacy = req.headers.get("x-paystack-signature");
  const apiSecret = Deno.env.get("PAYSTACK_SECRET_KEY");
  if (legacy && apiSecret && /^[0-9a-f]{128}$/.test(legacy)) {
    return secureEquals(legacy, await digest(apiSecret, raw));
  }
  return false;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("POST required", { status: 405 });
  try {
    const raw = await req.text();
    if (!(await authenticated(req, raw))) return new Response("Unauthorized", { status: 401 });
    const event = JSON.parse(raw);
    if (event.event !== "charge.success") return new Response("ok", { status: 200 });
    const reference = String(event.data?.reference ?? "");
    const result = await verifyAndSettle(reference);
    if (result !== "paid") return new Response("Payment not yet verified", { status: 503 });
    return new Response("ok", { status: 200 });
  } catch (error) {
    console.error("paystack-webhook error:", error);
    return new Response("Webhook failed", { status: 500 });
  }
});
