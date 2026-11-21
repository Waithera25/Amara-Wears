import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, json, verifyAndSettle } from "../_shared/paystack.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  try {
    const body = await req.json();
    const reference = String(body.reference ?? "");
    const status = await verifyAndSettle(reference);
    return json({ status });
  } catch (error) {
    console.error("paystack-confirm error:", error);
    return json({ status: "unconfirmed", error: "Unable to confirm payment. Please check your order later." }, 400);
  }
});
