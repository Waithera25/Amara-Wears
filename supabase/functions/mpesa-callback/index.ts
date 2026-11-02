
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing secret: ${name}`);
  return value;
}

function normalizePhone(phone: string): string {
  const cleaned = phone.replace(/[\s+()-]/g, "");

  if (/^07\d{8}$/.test(cleaned) || /^01\d{8}$/.test(cleaned)) {
    return "254" + cleaned.slice(1);
  }

  if (/^254[17]\d{8}$/.test(cleaned)) return cleaned;

  throw new Error("Enter a valid Kenyan mobile number.");
}

function timestamp(): string {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
    String(d.getHours()).padStart(2, "0"),
    String(d.getMinutes()).padStart(2, "0"),
    String(d.getSeconds()).padStart(2, "0"),
  ].join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json();
    const amount = Number(body.amount);
    const phone = normalizePhone(String(body.phone ?? ""));

    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 150000) {
      return json({ error: "Amount must be between KSh 1 and KSh 150,000." }, 400);
    }

    const shortcode = required("MPESA_SHORTCODE");
    const passkey = required("MPESA_PASSKEY");
    const consumerKey = required("MPESA_CONSUMER_KEY");
    const consumerSecret = required("MPESA_CONSUMER_SECRET");
    const callbackToken = required("MPESA_CALLBACK_TOKEN");

    const environment = Deno.env.get("MPESA_ENVIRONMENT") ?? "sandbox";

    const baseUrl = environment === "production"
      ? "https://api.safaricom.co.ke"
      : "https://sandbox.safaricom.co.ke";

    const supabaseUrl = required("SUPABASE_URL");

    const secretKeys = JSON.parse(required("SUPABASE_SECRET_KEYS"));
    const supabaseSecret = secretKeys.default;

    if (!supabaseSecret) {
      throw new Error("Supabase secret key is not configured.");
    }

    const supabase = createClient(supabaseUrl, supabaseSecret);

    // Generate a Daraja OAuth access token.
    const auth = btoa(`${consumerKey}:${consumerSecret}`);

    const authResponse = await fetch(
      `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
      {
        headers: { Authorization: `Basic ${auth}` },
      }
    );

    const authData = await authResponse.json();

    if (!authResponse.ok || !authData.access_token) {
      throw new Error("Could not authenticate with Safaricom.");
    }

    const time = timestamp();
    const password = btoa(`${shortcode}${passkey}${time}`);

    const orderReference =
      `KATAWA-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

    // Save a pending transaction before requesting payment.
    const { error: insertError } = await supabase
      .from("payments")
      .insert({
        order_reference: orderReference,
        phone_number: phone,
        amount,
        status: "pending",
      });

    if (insertError) throw insertError;

    const callbackUrl =
      `${supabaseUrl}/functions/v1/mpesa-callback?token=${encodeURIComponent(callbackToken)}`;

    const stkResponse = await fetch(
      `${baseUrl}/mpesa/stkpush/v1/processrequest`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authData.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          BusinessShortCode: shortcode,
          Password: password,
          Timestamp: time,
          TransactionType: "CustomerPayBillOnline",
          Amount: amount,
          PartyA: phone,
          PartyB: shortcode,
          PhoneNumber: phone,
          CallBackURL: callbackUrl,
          AccountReference: orderReference,
          TransactionDesc: "KATAWA WEAR purchase",
        }),
      }
    );

    const stkData = await stkResponse.json();

    if (!stkResponse.ok || stkData.ResponseCode !== "0") {
      await supabase
        .from("payments")
        .update({
          status: "failed",
          result_description:
            stkData.errorMessage ?? stkData.ResponseDescription ?? "STK request failed",
          updated_at: new Date().toISOString(),
        })
        .eq("order_reference", orderReference);

      return json({
        success: false,
        error: stkData.errorMessage ?? stkData.ResponseDescription ?? "STK Push failed",
      }, 400);
    }

    await supabase
      .from("payments")
      .update({
        status: "processing",
        merchant_request_id: stkData.MerchantRequestID,
        checkout_request_id: stkData.CheckoutRequestID,
        updated_at: new Date().toISOString(),
      })
      .eq("order_reference", orderReference);

    return json({
      success: true,
      message: "Payment prompt sent. Check your phone.",
      orderReference,
      checkoutRequestId: stkData.CheckoutRequestID,
    });

  } catch (error) {
    console.error("M-Pesa initiation error:", error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : "Payment could not be initiated.",
    }, 500);
  }
});
