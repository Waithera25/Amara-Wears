import { createClient } from "npm:@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(payload: unknown, status = 200): Response {
  return Response.json(payload, { status, headers: corsHeaders });
}

export function secret(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing server secret: ${name}`);
  return value;
}

export function adminClient() {
  return createClient(secret("SUPABASE_URL"), secret("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function validEmail(value: unknown): string {
  const email = String(value ?? "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address.");
  }
  return email;
}

export function textField(value: unknown, label: string, max = 500): string {
  const text = String(value ?? "").trim();
  if (!text || text.length > max) throw new Error(`Invalid ${label}.`);
  return text;
}

// Never accept an amount, price, order status, or user ID from the browser.
export async function verifyAndSettle(reference: string): Promise<"paid" | "pending"> {
  if (!/^KW[RC]-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(reference)) {
    throw new Error("Invalid payment reference.");
  }
  const table = reference.startsWith("KWR-") ? "orders" : "custom_orders";
  const db = adminClient();
  const { data: order, error: lookupError } = await db
    .from(table).select("*").eq("payment_reference", reference).maybeSingle();
  if (lookupError) throw lookupError;
  if (!order) throw new Error("Payment reference not found.");

  if (order.payment_status === "paid") return "paid";

  const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secret("PAYSTACK_SECRET_KEY")}` },
  });
  if (!res.ok) throw new Error("Payment verification is unavailable.");
  const payload = await res.json();
  const tx = payload?.data;
  if (payload?.status !== true || tx?.reference !== reference) {
    throw new Error("Invalid verification response.");
  }
  if (tx.status !== "success") return "pending";

  const expectedAmount = Number(table === "orders" ? order.total : order.deposit_amount) * 100;
  if (tx.currency !== "KES" || tx.amount !== expectedAmount ||
      String(tx.customer?.email ?? "").trim().toLowerCase() !== order.customer_email) {
    console.error("Payment amount, currency, or email mismatch", reference);
    throw new Error("Payment details do not match this order.");
  }
  const { error } = await db.from(table)
    .update({ payment_status: "paid", status: "paid" })
    .eq("id", order.id)
    .eq("payment_reference", reference)
    .neq("payment_status", "paid");
  if (error) throw error;
  return "paid";
}
