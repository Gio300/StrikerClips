import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const webhookId = request.headers.get("x-shopify-webhook-id");
  const { topic, shop, payload } = await authenticate.webhook(request);
  const forwardUrl = process.env.TKO_WEBHOOK_FORWARD_URL;
  const bridgeSecret = process.env.TKO_SHOPIFY_BRIDGE_SECRET;

  if (!forwardUrl || !bridgeSecret) {
    console.log(`Received ${topic} for ${shop}; TKO forwarding is not configured.`);
    return new Response();
  }

  const response = await fetch(forwardUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${bridgeSecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ topic, shop, webhookId, payload }),
  });

  if (!response.ok) {
    throw new Response("TKO order webhook forwarding failed", { status: 502 });
  }

  return new Response();
};
