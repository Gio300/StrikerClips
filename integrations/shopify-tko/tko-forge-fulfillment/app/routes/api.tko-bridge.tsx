import { timingSafeEqual } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import { unauthenticated } from "../shopify.server";

type BridgeVariant = {
  id: string;
  sku: string;
  size: string;
  color: string;
  price_cents: number;
};

type BridgeProduct = {
  external_id: string;
  title: string;
  description?: string;
  artwork_url: string;
  artifact_id: string;
  seller_user_id: string;
  price_cents: number;
  variants: BridgeVariant[];
};

type BridgeOrder = {
  external_id: string;
  email?: string;
  shipping_address?: Record<string, unknown>;
  currency: string;
  item_subtotal_cents: number;
  shipping_charge_cents: number;
  tax_cents: number;
  total_cents: number;
  stripe_payment_intent_id: string;
  line_items: Array<{
    shopify_variant_gid?: string | null;
    title: string;
    sku: string;
    quantity: number;
    price_cents: number;
    size: string;
    color: string;
  }>;
};

type GraphqlClient = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

const json = (payload: unknown, status = 200) =>
  Response.json(payload, { status, headers: { "Cache-Control": "no-store" } });

const secureEqual = (left: string, right: string) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

const clean = (value: unknown, max = 200) =>
  String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);

const requireHttps = (value: unknown) => {
  const url = new URL(String(value || ""));
  if (url.protocol !== "https:") throw new Error("Artwork must use public HTTPS.");
  return url.toString();
};

const graph = async <T,>(
  admin: GraphqlClient,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> => {
  const response = await admin.graphql(query, { variables });
  const body = await response.json() as {
    data?: T;
    errors?: Array<{ message?: string }>;
  };
  if (!response.ok || body.errors?.length || !body.data) {
    throw new Error(body.errors?.map((error) => error.message).filter(Boolean).join("; ") || "Shopify GraphQL failed.");
  }
  return body.data;
};

const userError = (errors: Array<{ message?: string }> | null | undefined) => {
  const messages = (errors || []).map((error) => clean(error.message, 300)).filter(Boolean);
  if (messages.length) throw new Error(messages.join("; "));
};

const productTag = (externalId: string) => `tko-external-${externalId}`;
const orderTag = (externalId: string) => `tko-order-${externalId}`;

async function productByTag(admin: GraphqlClient, tag: string) {
  const data = await graph<{
    products: {
      nodes: Array<{
        id: string;
        title: string;
        status: string;
        variants: {
          nodes: Array<{
            id: string;
            sku: string;
            selectedOptions: Array<{ name: string; value: string }>;
          }>;
        };
      }>;
    };
  }>(
    admin,
    `#graphql
      query TkoProductByExternalTag($query: String!) {
        products(first: 1, query: $query) {
          nodes {
            id title status
            variants(first: 100) {
              nodes { id sku selectedOptions { name value } }
            }
          }
        }
      }`,
    { query: `tag:${tag}` },
  );
  return data.products.nodes[0] || null;
}

const mappedVariants = (
  input: BridgeVariant[],
  nodes: Array<{ id: string; sku: string; selectedOptions: Array<{ name: string; value: string }> }>,
) => input.map((variant) => {
  const bySku = nodes.find((node) => node.sku === variant.sku);
  const byOptions = nodes.find((node) => {
    const options = Object.fromEntries(node.selectedOptions.map((option) => [option.name, option.value]));
    return options.Size === variant.size && options.Color === variant.color;
  });
  return { local_id: variant.id, id: (bySku || byOptions)?.id || null, sku: variant.sku };
});

async function syncProductDraft(admin: GraphqlClient, shop: string, product: BridgeProduct) {
  const externalId = clean(product.external_id, 160);
  const title = clean(product.title, 120);
  const variants = Array.isArray(product.variants) ? product.variants : [];
  if (!externalId || title.length < 3 || !variants.length) throw new Error("A valid TKO product and variants are required.");
  const artworkUrl = requireHttps(product.artwork_url);
  const tag = productTag(externalId);
  const existing = await productByTag(admin, tag);
  if (existing) {
    return {
      id: existing.id,
      status: existing.status,
      shop,
      reused: true,
      variants: mappedVariants(variants, existing.variants.nodes),
    };
  }

  const colors = Array.from(new Set(variants.map((variant) => clean(variant.color, 30))));
  const sizes = Array.from(new Set(variants.map((variant) => clean(variant.size, 20))));
  const created = await graph<{
    productCreate: {
      product: { id: string; status: string; variants: { nodes: Array<{ id: string }> } } | null;
      userErrors: Array<{ message?: string }>;
    };
  }>(
    admin,
    `#graphql
      mutation TkoBridgeCreateProduct($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
        productCreate(product: $product, media: $media) {
          product { id status variants(first: 1) { nodes { id } } }
          userErrors { field message }
        }
      }`,
    {
      product: {
        title,
        descriptionHtml: `<p>${clean(product.description, 500)}</p><p>Creator-forged through TKO. Provider mapping and fulfillment remain held for review.</p>`,
        productType: "T-Shirt",
        vendor: "TKO Creator Forge",
        status: "DRAFT",
        tags: ["TKO Forge", "Creator Merch", tag],
        productOptions: [
          { name: "Color", values: colors.map((name) => ({ name })) },
          { name: "Size", values: sizes.map((name) => ({ name })) },
        ],
        metafields: [
          { namespace: "$app", key: "tko_asset_id", type: "single_line_text_field", value: clean(product.artifact_id, 160) },
          { namespace: "$app", key: "tko_creator_id", type: "single_line_text_field", value: clean(product.seller_user_id, 160) },
          { namespace: "$app", key: "tko_artwork_url", type: "url", value: artworkUrl },
          { namespace: "$app", key: "tko_product_type", type: "single_line_text_field", value: "tshirt" },
          { namespace: "$app", key: "tko_fulfillment_provider", type: "single_line_text_field", value: "printful_draft" },
          { namespace: "$app", key: "tko_status", type: "single_line_text_field", value: "approved_draft" },
        ],
      },
      media: [{
        originalSource: artworkUrl,
        alt: `${title} approved TKO artwork`,
        mediaContentType: "IMAGE",
      }],
    },
  );
  userError(created.productCreate.userErrors);
  const productId = created.productCreate.product?.id;
  const firstVariantId = created.productCreate.product?.variants.nodes[0]?.id;
  if (!productId || !firstVariantId) throw new Error("Shopify did not create the initial product variant.");

  const [first, ...remaining] = variants;
  const updated = await graph<{
    productVariantsBulkUpdate: { userErrors: Array<{ message?: string }> };
  }>(
    admin,
    `#graphql
      mutation TkoBridgeUpdateInitialVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          userErrors { field message }
        }
      }`,
    {
      productId,
      variants: [{
        id: firstVariantId,
        price: (first.price_cents / 100).toFixed(2),
        inventoryItem: { sku: clean(first.sku, 80) },
        optionValues: [
          { optionName: "Color", name: first.color },
          { optionName: "Size", name: first.size },
        ],
      }],
    },
  );
  userError(updated.productVariantsBulkUpdate.userErrors);

  if (remaining.length) {
    const bulk = await graph<{
      productVariantsBulkCreate: { userErrors: Array<{ message?: string }> };
    }>(
      admin,
      `#graphql
        mutation TkoBridgeCreateVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkCreate(productId: $productId, variants: $variants) {
            userErrors { field message }
          }
        }`,
      {
        productId,
        variants: remaining.map((variant) => ({
          price: (variant.price_cents / 100).toFixed(2),
          inventoryItem: { sku: clean(variant.sku, 80) },
          optionValues: [
            { optionName: "Color", name: variant.color },
            { optionName: "Size", name: variant.size },
          ],
        })),
      },
    );
    userError(bulk.productVariantsBulkCreate.userErrors);
  }

  const refreshed = await productByTag(admin, tag);
  if (!refreshed) throw new Error("Created Shopify product could not be reloaded.");
  return {
    id: refreshed.id,
    status: refreshed.status,
    shop,
    variants: mappedVariants(variants, refreshed.variants.nodes),
  };
}

async function orderByTag(admin: GraphqlClient, tag: string) {
  const data = await graph<{
    orders: { nodes: Array<{ id: string; name: string; displayFinancialStatus: string }> };
  }>(
    admin,
    `#graphql
      query TkoOrderByExternalTag($query: String!) {
        orders(first: 1, query: $query) {
          nodes { id name displayFinancialStatus }
        }
      }`,
    { query: `tag:${tag}` },
  );
  return data.orders.nodes[0] || null;
}

async function createPaidOrder(admin: GraphqlClient, shop: string, order: BridgeOrder) {
  const externalId = clean(order.external_id, 160);
  if (!externalId || !order.line_items?.length) throw new Error("A valid paid TKO order is required.");
  const tag = orderTag(externalId);
  const existing = await orderByTag(admin, tag);
  if (existing) return { ...existing, shop, reused: true };

  const currency = clean(order.currency || "USD", 3).toUpperCase();
  const shipping = order.shipping_address || {};
  const fullName = clean((shipping as any).name, 120);
  const names = fullName.split(" ");
  const firstName = names.slice(0, -1).join(" ") || names[0] || "TKO";
  const lastName = names.length > 1 ? names.at(-1) : "Buyer";
  const moneyBag = (cents: number) => ({
    shopMoney: { amount: (Number(cents || 0) / 100).toFixed(2), currencyCode: currency },
  });
  const lineItems = order.line_items.map((item) => item.shopify_variant_gid
    ? { variantId: item.shopify_variant_gid, quantity: item.quantity }
    : {
        title: item.title,
        variantTitle: `${item.color} / ${item.size}`,
        sku: item.sku,
        quantity: item.quantity,
        requiresShipping: true,
        taxable: true,
        priceSet: moneyBag(item.price_cents),
      });
  const beforeTax = Math.max(1, Number(order.item_subtotal_cents || 0) + Number(order.shipping_charge_cents || 0));
  const taxCents = Math.max(0, Number(order.tax_cents || 0));
  const input: Record<string, unknown> = {
    currency,
    email: clean(order.email, 200) || undefined,
    financialStatus: "PAID",
    fulfillmentStatus: "UNFULFILLED",
    lineItems,
    shippingAddress: {
      firstName,
      lastName,
      address1: clean((shipping as any).line1, 200),
      address2: clean((shipping as any).line2, 200) || undefined,
      city: clean((shipping as any).city, 100),
      provinceCode: clean((shipping as any).state, 20),
      countryCode: clean((shipping as any).country, 2).toUpperCase(),
      zip: clean((shipping as any).postal_code, 24),
    },
    shippingLines: [{
      title: "TKO tracked shipping",
      code: "TKO_TRACKED",
      source: "TKO",
      priceSet: moneyBag(order.shipping_charge_cents),
    }],
    sourceIdentifier: externalId,
    sourceUrl: `https://tko.cam/forge/physical?order=${encodeURIComponent(externalId)}`,
    note: `Paid in TKO through Stripe. PaymentIntent: ${clean(order.stripe_payment_intent_id, 200)}`,
    poNumber: `TKO-${externalId}`,
    tags: ["TKO", "TKO Physical Forge", tag],
    test: process.env.TKO_SHOPIFY_TEST_ORDERS !== "0",
    transactions: [{
      kind: "SALE",
      status: "SUCCESS",
      gateway: "Stripe via TKO",
      test: process.env.TKO_SHOPIFY_TEST_ORDERS !== "0",
      amountSet: moneyBag(order.total_cents),
      receiptJson: JSON.stringify({ stripe_payment_intent_id: clean(order.stripe_payment_intent_id, 200) }),
    }],
  };
  if (taxCents > 0) {
    input.taxLines = [{
      title: "Stripe automatic tax",
      rate: Number((taxCents / beforeTax).toFixed(6)),
      priceSet: moneyBag(taxCents),
      channelLiable: true,
    }];
  }

  const created = await graph<{
    orderCreate: {
      order: { id: string; name: string; displayFinancialStatus: string } | null;
      userErrors: Array<{ message?: string }>;
    };
  }>(
    admin,
    `#graphql
      mutation TkoBridgeCreatePaidOrder($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
        orderCreate(order: $order, options: $options) {
          order { id name displayFinancialStatus }
          userErrors { field message }
        }
      }`,
    { order: input, options: { sendReceipt: false, sendFulfillmentReceipt: false } },
  );
  userError(created.orderCreate.userErrors);
  if (!created.orderCreate.order) throw new Error("Shopify did not return the mirrored order.");
  return { ...created.orderCreate.order, shop };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const configuredSecret = String(process.env.TKO_SHOPIFY_BRIDGE_SECRET || "");
  const receivedSecret = String(request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!configuredSecret || !receivedSecret || !secureEqual(receivedSecret, configuredSecret)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  const shop = clean(process.env.TKO_SHOPIFY_SHOP_DOMAIN, 200).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
    return json({ ok: false, error: "TKO_SHOPIFY_SHOP_DOMAIN is not configured." }, 503);
  }

  try {
    const payload = await request.json() as {
      operation?: string;
      product?: BridgeProduct;
      order?: BridgeOrder;
    };
    const { admin } = await unauthenticated.admin(shop);
    const result = payload.operation === "sync_product_draft" && payload.product
      ? await syncProductDraft(admin, shop, payload.product)
      : payload.operation === "create_paid_order" && payload.order
        ? await createPaidOrder(admin, shop, payload.order)
        : null;
    if (!result) return json({ ok: false, error: "unsupported_operation" }, 400);
    return json({ ok: true, result });
  } catch (error) {
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "Shopify bridge failed.",
    }, 502);
  }
};
