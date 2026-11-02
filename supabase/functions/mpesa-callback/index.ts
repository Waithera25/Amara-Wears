
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

Deno.serve(async (req) => {
      if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
      }

      if (req.method !== "POST") {
        return Response.json(
          { error: "POST required" },
          { status: 405, headers: corsHeaders }
        );
      }

      try {
        const url = new URL(req.url);
        const suppliedToken = url.searchParams.get("token");
        const expectedToken = Deno.env.get("MPESA_CALLBACK_TOKEN");

        if (
          !expectedToken ||
          !suppliedToken ||
          suppliedToken !== expectedToken
        ) {
          return Response.json(
            { error: "Unauthorized" },
            { status: 401, headers: corsHeaders }
          );
        }

        const payload = await req.json();
        const callback = payload?.Body?.stkCallback;

        if (!callback?.CheckoutRequestID) {
          return Response.json(
            { error: "Invalid callback payload" },
            { status: 400, headers: corsHeaders }
          );
        }

        const checkoutRequestId = callback.CheckoutRequestID;
        const resultCode = Number(callback.ResultCode);
        const successful = resultCode === 0;

        const metadata = callback.CallbackMetadata?.Item ?? [];

        const getValue = (name: string) =>
          metadata.find(
            (item: { Name: string }) => item.Name === name
          )?.Value;

        const receipt = getValue("MpesaReceiptNumber");

        const { data, error } = await supabaseAdmin
          .from("payments")
          .update({
            status: successful ? "successful" : "failed",
            mpesa_receipt_number: receipt
              ? String(receipt)
              : null,
            result_code: String(resultCode),
            result_description: callback.ResultDesc ?? "",
            updated_at: new Date().toISOString(),
          })
          .eq("checkout_request_id", checkoutRequestId)
          .eq("status", "processing")
          .select("id");

        if (error) throw error;

        console.log("M-Pesa callback:", {
          checkoutRequestId,
          resultCode,
          updatedRecords: data?.length ?? 0,
        });

        return Response.json(
          {
            ResultCode: 0,
            ResultDesc: "Callback received successfully",
          },
          { headers: corsHeaders }
        );

      } catch (error) {
        console.error("Callback error:", error);

        return Response.json(
          {
            ResultCode: 1,
            ResultDesc: "Callback processing failed",
          },
          { status: 500, headers: corsHeaders }
        );
      }
});
