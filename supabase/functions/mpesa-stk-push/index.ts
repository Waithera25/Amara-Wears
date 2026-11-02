
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

interface PaymentRequest {
  amount: number;
  phone: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: corsHeaders,
  });
}

function getSecret(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing secret: ${name}`);
  return value;
}

function normalizePhone(phone: string): string {
  const cleaned = phone.replace(/[\s+()-]/g, "");

  if (/^0[17]\d{8}$/.test(cleaned)) {
    return `254${cleaned.slice(1)}`;
  }

  if (/^254[17]\d{8}$/.test(cleaned)) {
    return cleaned;
  }

  throw new Error("Invalid Kenyan phone number.");
}

function getTimestamp(): string {
  const d = new Date();

  return (
    d.getFullYear().toString() +
    String(d.getMonth() + 1).padStart(2, "0") +
    String(d.getDate()).padStart(2, "0") +
    String(d.getHours()).padStart(2, "0") +
    String(d.getMinutes()).padStart(2, "0") +
    String(d.getSeconds()).padStart(2, "0")
  );
}

export default {
  fetch: async (req: Request) => {
      if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
      }

      if (req.method !== "POST") {
        return json({ error: "POST required" }, 405);
      }

      try {
        const supabaseAdmin = createClient(
          getSecret("SUPABASE_URL"),
          getSecret("SUPABASE_SERVICE_ROLE_KEY"),
          { auth: { autoRefreshToken: false, persistSession: false } }
        );

        const body: PaymentRequest = await req.json();
        const amount = Number(body.amount);
        const phone = normalizePhone(String(body.phone ?? ""));

        if (
          !Number.isSafeInteger(amount) ||
          amount < 1 ||
          amount > 150000
        ) {
          return json({ error: "Invalid payment amount." }, 400);
        }

        const consumerKey = getSecret("MPESA_CONSUMER_KEY");
        const consumerSecret = getSecret("MPESA_CONSUMER_SECRET");
        const shortcode = getSecret("MPESA_SHORTCODE");
        const passkey = getSecret("MPESA_PASSKEY");
        const callbackToken = getSecret("MPESA_CALLBACK_TOKEN");
        const supabaseUrl = getSecret("SUPABASE_URL");

        const baseUrl =
          Deno.env.get("MPESA_ENVIRONMENT") === "production"
            ? "https://api.safaricom.co.ke"
            : "https://sandbox.safaricom.co.ke";

        // Authenticate with Daraja.
        const credentials = btoa(
          `${consumerKey}:${consumerSecret}`
        );

        const authResponse = await fetch(
          `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
          {
            headers: {
              Authorization: `Basic ${credentials}`,
            },
          }
        );

        const authData = await authResponse.json();

        if (!authResponse.ok || !authData.access_token) {
          throw new Error("Daraja authentication failed.");
        }

        const timestamp = getTimestamp();
        const password = btoa(
          `${shortcode}${passkey}${timestamp}`
        );

        const orderReference =
          `KATAWA-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

        // Create payment record.
        const { error: insertError } =
          await supabaseAdmin
            .from("payments")
            .insert({
              order_reference: orderReference,
              phone_number: phone,
              amount,
              status: "pending",
            });

        if (insertError) throw insertError;

        const callbackUrl =
          `${supabaseUrl}/functions/v1/mpesa-callback` +
          `?token=${encodeURIComponent(callbackToken)}`;

        // Initiate STK Push.
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
              Timestamp: timestamp,
              TransactionType:
                Deno.env.get("MPESA_TRANSACTION_TYPE") ??
                "CustomerPayBillOnline",
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

        if (
          !stkResponse.ok ||
          stkData.ResponseCode !== "0" ||
          !stkData.CheckoutRequestID
        ) {
          await supabaseAdmin
            .from("payments")
            .update({
              status: "failed",
              result_description:
                stkData.errorMessage ??
                stkData.ResponseDescription ??
                "STK Push failed",
              updated_at: new Date().toISOString(),
            })
            .eq("order_reference", orderReference);

          throw new Error(
            stkData.errorMessage ??
            stkData.ResponseDescription ??
            "STK Push failed."
          );
        }

        await supabaseAdmin
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
          message: "STK Push sent. Check your phone.",
          orderReference,
          checkoutRequestId: stkData.CheckoutRequestID,
        });

      } catch (error) {
        console.error("Payment error:", error);

        return json({
          success: false,
          error: error instanceof Error
            ? error.message
            : "Payment request failed.",
        }, 500);
      }
    }
};
