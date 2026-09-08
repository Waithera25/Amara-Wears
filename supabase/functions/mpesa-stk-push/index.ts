import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

function timestamp() {
  const now = new Date();
  const parts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0")
  ];
  return parts.join("");
}

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const { amount, phone, description } = await request.json();
    const shortcode = Deno.env.get("MPESA_SHORTCODE");
    const passkey = Deno.env.get("MPESA_PASSKEY");
    const consumerKey = Deno.env.get("MPESA_CONSUMER_KEY");
    const consumerSecret = Deno.env.get("MPESA_CONSUMER_SECRET");
    const callbackUrl = Deno.env.get("MPESA_CALLBACK_URL");
    const environment = Deno.env.get("MPESA_ENVIRONMENT") === "production" ? "production" : "sandbox";

    if (!shortcode || !passkey || !consumerKey || !consumerSecret || !callbackUrl) {
      return jsonResponse({ error: "M-Pesa server configuration is incomplete" }, 500);
    }
    if (!Number.isInteger(amount) || amount < 1 || !/^254[17]\d{8}$/.test(phone)) {
      return jsonResponse({ error: "Invalid amount or phone number" }, 400);
    }

    const baseUrl = environment === "production"
      ? "https://api.safaricom.co.ke"
      : "https://sandbox.safaricom.co.ke";
    const basicAuth = btoa(`${consumerKey}:${consumerSecret}`);
    const tokenResponse = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${basicAuth}` }
    });
    const token = await tokenResponse.json();
    if (!tokenResponse.ok || !token.access_token) {
      return jsonResponse({ error: "Could not authenticate with M-Pesa" }, 502);
    }

    const requestTimestamp = timestamp();
    const password = btoa(`${shortcode}${passkey}${requestTimestamp}`);
    const stkResponse = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: requestTimestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: amount,
        PartyA: phone,
        PartyB: shortcode,
        PhoneNumber: phone,
        CallBackURL: callbackUrl,
        AccountReference: "KATAWA WEAR",
        TransactionDesc: String(description || "KATAWA WEAR payment").slice(0, 50)
      })
    });
    const result = await stkResponse.json();

    if (!stkResponse.ok || result.ResponseCode !== "0") {
      return jsonResponse({ error: result.errorMessage || result.ResponseDescription || "Could not start M-Pesa payment" }, 502);
    }

    return jsonResponse({ checkoutRequestId: result.CheckoutRequestID, customerMessage: result.CustomerMessage });
  } catch (_error) {
    return jsonResponse({ error: "Could not start M-Pesa payment" }, 500);
  }
});
