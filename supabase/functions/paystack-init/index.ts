import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { adminClient, corsHeaders, json, secret, textField, validEmail } from "../_shared/paystack.ts";

function optional(value: unknown, max = 500): string {
  const v = String(value ?? "").trim();
  if (v.length > max) throw new Error("A field is too long.");
  return v;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  let table: "orders" | "custom_orders" | undefined;
  let recordId: string | undefined;
  try {
    const body = await req.json();
    const db = adminClient();
    const email = validEmail(body.email);
    const contactMethod = textField(body.contact_method, "contact method", 30);
    const allowedContacts = ["WhatsApp", "Phone call", "SMS", "Email", "Instagram DM"];
    if (!allowedContacts.includes(contactMethod)) throw new Error("Invalid contact method.");
    const contactValue = textField(body.contact_value, "contact details", 160);

    // Guests may order. Only attach user_id if Supabase validates a real user session.
    let userId: string | null = null;
    const jwt = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (jwt) {
      const { data } = await db.auth.getUser(jwt);
      if (data.user) userId = data.user.id;
    }

    const reference = `${body.kind === "custom" ? "KWC" : "KWR"}-${crypto.randomUUID()}`;
    let amountKes: number;

    if (body.kind === "ready") {
      table = "orders";
      const items = body.items;
      if (!Array.isArray(items) || items.length < 1 || items.length > 20) {
        throw new Error("Add between 1 and 20 items to your bag.");
      }
      const ids = items.map((item: any) => Number(item.id));
      if (ids.some((id: number) => !Number.isSafeInteger(id))) throw new Error("Invalid product.");
      const { data: catalog, error: catalogError } = await db.from("katawa_catalog")
        .select("id,name,price_kes,sizes,sold_out,active").in("id", ids);
      if (catalogError) throw catalogError;
      const products = new Map((catalog ?? []).map((p: any) => [p.id, p]));
      const verifiedItems: any[] = [];
      let subtotal = 0;
      for (const input of items) {
        const p: any = products.get(Number(input.id));
        const size = String(input.size ?? "");
        const qty = Number(input.qty);
        if (!p || !p.active || !p.sizes.includes(size) || p.sold_out.includes(size) ||
            !Number.isSafeInteger(qty) || qty < 1 || qty > 10) {
          throw new Error("An item or size is unavailable.");
        }
        subtotal += p.price_kes * qty;
        verifiedItems.push({ product_id: p.id, name: p.name, size, qty, price: p.price_kes });
      }
      if (!Number.isSafeInteger(subtotal) || subtotal < 1 || subtotal > 500000) {
        throw new Error("Invalid cart total.");
      }
      const location = textField(body.delivery_location, "delivery location", 30);
      if (!["Nairobi", "Outside Nairobi"].includes(location)) throw new Error("Invalid delivery location.");
      const deliveryFee = subtotal > 10000 ? 0 : (location === "Nairobi" ? 250 : 400);
      amountKes = subtotal + deliveryFee;
      const { data, error } = await db.from("orders").insert({
        user_id: userId, items: verifiedItems, subtotal,
        delivery_location: location,
        delivery_address: textField(body.delivery_address, "delivery address", 500),
        delivery_fee: deliveryFee, total: amountKes, contact_method: contactMethod,
        contact_value: contactValue, customer_email: email,
        payment_provider: "paystack", payment_status: "pending",
        payment_reference: reference, status: "payment_pending",
      }).select("id").single();
      if (error) throw error;
      recordId = data.id;
    } else if (body.kind === "custom") {
      table = "custom_orders";
      const garment = textField(body.garment, "garment", 80);
      const { data: rate, error: rateError } = await db.from("katawa_custom_prices")
        .select("price_kes,active").eq("garment", garment).maybeSingle();
      if (rateError) throw rateError;
      if (!rate?.active) throw new Error("That garment is unavailable.");
      amountKes = Math.round(rate.price_kes * 0.5);
      const { data, error } = await db.from("custom_orders").insert({
        user_id: userId, garment,
        color_fabric: optional(body.color_fabric, 300),
        bust: textField(body.bust, "bust measurement", 40),
        waist: textField(body.waist, "waist measurement", 40),
        hips: textField(body.hips, "hip measurement", 40),
        crotch_length: optional(body.crotch_length, 40),
        height: optional(body.height, 40),
        shoulder: optional(body.shoulder, 40),
        notes: optional(body.notes, 1000),
        deposit_amount: amountKes, contact_method: contactMethod,
        contact_value: contactValue, customer_email: email,
        payment_provider: "paystack", payment_status: "pending",
        payment_reference: reference, status: "payment_pending",
      }).select("id").single();
      if (error) throw error;
      recordId = data.id;
    } else {
      throw new Error("Unknown order type.");
    }

    const base = Deno.env.get("KATAWA_SITE_URL") ?? "https://katawa.kamalitamara.me/";
    const callback = new URL(base);
    if (callback.protocol !== "https:") throw new Error("KATAWA_SITE_URL must use HTTPS.");
    callback.searchParams.set("payment", "return");

    const paystack = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret("PAYSTACK_SECRET_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: String(amountKes * 100), currency: "KES", email, reference,
        callback_url: callback.toString(), channels: ["card", "mobile_money"],
      }),
    });
    const result = await paystack.json();
    if (!paystack.ok || result.status !== true || !result.data?.authorization_url) {
      throw new Error("Paystack could not start the payment.");
    }
    return json({ authorization_url: result.data.authorization_url, reference });
  } catch (error) {
    if (table && recordId) {
      await adminClient().from(table).update({ payment_status: "failed", status: "payment_init_failed" })
        .eq("id", recordId).eq("payment_status", "pending");
    }
    console.error("paystack-init error:", error);
    const message = error instanceof Error ? error.message : "Checkout failed.";
    const expected = /^(Enter|Invalid|Add |An item|That garment|Unknown)/.test(message);
    return json({ error: expected ? message : "Could not start payment. Please try again." }, expected ? 400 : 500);
  }
});
