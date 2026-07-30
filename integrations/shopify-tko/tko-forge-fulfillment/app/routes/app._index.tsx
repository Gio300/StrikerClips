import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

const SHIRT_SIZES = ["S", "M", "L", "XL", "2XL"] as const;

type UserError = {
  field?: string[] | null;
  message: string;
};

type ProductResult = {
  id: string;
  title: string;
  handle: string;
  status: string;
  variants: {
    edges: Array<{ node: { id: string; title: string; price: string } }>;
  };
};

type ActionResult =
  | { ok: true; product: ProductResult; variantCount: number }
  | { ok: false; errors: string[] };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

const text = (form: FormData, key: string, max: number) =>
  String(form.get(key) || "").trim().slice(0, max);

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character] || character);

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResult> => {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();
  const title = text(form, "title", 120);
  const artifactId = text(form, "artifactId", 160);
  const creatorId = text(form, "creatorId", 160);
  const creatorHandle = text(form, "creatorHandle", 80);
  const artworkUrl = text(form, "artworkUrl", 2000);
  const priceCents = Math.round(Number(form.get("priceDollars")) * 100);
  const errors: string[] = [];

  if (title.length < 3) errors.push("Product title must be at least 3 characters.");
  if (!artifactId) errors.push("A TKO artifact ID is required.");
  if (!creatorId) errors.push("A TKO creator or clan ID is required.");
  if (!creatorHandle) errors.push("A creator or clan handle is required.");
  if (!Number.isSafeInteger(priceCents) || priceCents < 2000 || priceCents > 15000) {
    errors.push("T-shirt price must be between $20.00 and $150.00.");
  }
  try {
    const parsed = new URL(artworkUrl);
    if (parsed.protocol !== "https:") errors.push("Artwork must use a public HTTPS URL.");
  } catch {
    errors.push("Artwork must be a valid public HTTPS URL.");
  }
  if (errors.length) return { ok: false, errors };

  const price = (priceCents / 100).toFixed(2);
  const createResponse = await admin.graphql(
    `#graphql
      mutation TkoCreateForgedShirt($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
        productCreate(product: $product, media: $media) {
          product {
            id
            title
            handle
            status
            variants(first: 5) {
              edges {
                node {
                  id
                  title
                  price
                }
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }`,
    {
      variables: {
        product: {
          title,
          descriptionHtml:
            `<p>Creator-forged TKO shirt by <strong>${escapeHtml(creatorHandle)}</strong>.</p>` +
            "<p>Printed on demand. This product remains a draft until artwork and provider mapping are approved.</p>",
          productType: "T-Shirt",
          vendor: `TKO / ${creatorHandle}`,
          status: "DRAFT",
          tags: ["TKO Forge", "Creator Merch", "T-Shirt", `tko-creator:${creatorHandle}`],
          productOptions: [
            { name: "Color", values: [{ name: "Black" }] },
            { name: "Size", values: SHIRT_SIZES.map((name) => ({ name })) },
          ],
          metafields: [
            { namespace: "$app", key: "tko_asset_id", type: "single_line_text_field", value: artifactId },
            { namespace: "$app", key: "tko_creator_id", type: "single_line_text_field", value: creatorId },
            { namespace: "$app", key: "tko_creator_handle", type: "single_line_text_field", value: creatorHandle },
            { namespace: "$app", key: "tko_artwork_url", type: "url", value: artworkUrl },
            { namespace: "$app", key: "tko_product_type", type: "single_line_text_field", value: "tshirt" },
            { namespace: "$app", key: "tko_fulfillment_provider", type: "single_line_text_field", value: "unassigned" },
            { namespace: "$app", key: "tko_status", type: "single_line_text_field", value: "approved_draft" },
          ],
        },
        media: [{
          originalSource: artworkUrl,
          alt: `${title} approved TKO artwork`,
          mediaContentType: "IMAGE",
        }],
      },
    },
  );
  const createJson = await createResponse.json() as {
    data?: {
      productCreate?: {
        product?: ProductResult | null;
        userErrors?: UserError[];
      };
    };
  };
  const createPayload = createJson.data?.productCreate;
  const createErrors = createPayload?.userErrors || [];
  const product = createPayload?.product;
  if (!product || createErrors.length) {
    return {
      ok: false,
      errors: createErrors.map((error) => error.message).concat(
        product ? [] : ["Shopify did not return the created product."],
      ),
    };
  }

  const initialVariantId = product.variants.edges[0]?.node.id;
  if (!initialVariantId) {
    return { ok: false, errors: ["Shopify created the product without an initial variant."] };
  }

  const updateResponse = await admin.graphql(
    `#graphql
      mutation TkoPriceInitialShirtVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          userErrors { field message }
        }
      }`,
    {
      variables: {
        productId: product.id,
        variants: [{ id: initialVariantId, price }],
      },
    },
  );
  const updateJson = await updateResponse.json() as {
    data?: { productVariantsBulkUpdate?: { userErrors?: UserError[] } };
  };
  const updateErrors = updateJson.data?.productVariantsBulkUpdate?.userErrors || [];
  if (updateErrors.length) {
    return { ok: false, errors: updateErrors.map((error) => error.message) };
  }

  const remainingSizes = SHIRT_SIZES.slice(1);
  const variantsResponse = await admin.graphql(
    `#graphql
      mutation TkoCreateShirtSizes($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkCreate(productId: $productId, variants: $variants) {
          productVariants { id title price }
          userErrors { field message }
        }
      }`,
    {
      variables: {
        productId: product.id,
        variants: remainingSizes.map((size) => ({
          price,
          optionValues: [
            { optionName: "Color", name: "Black" },
            { optionName: "Size", name: size },
          ],
        })),
      },
    },
  );
  const variantsJson = await variantsResponse.json() as {
    data?: {
      productVariantsBulkCreate?: {
        productVariants?: Array<{ id: string }>;
        userErrors?: UserError[];
      };
    };
  };
  const variantsPayload = variantsJson.data?.productVariantsBulkCreate;
  const variantErrors = variantsPayload?.userErrors || [];
  if (variantErrors.length) {
    return { ok: false, errors: variantErrors.map((error) => error.message) };
  }

  // The product intentionally remains DRAFT. A print-on-demand provider still
  // needs to map SKUs/print areas before a merchant publishes it.
  return {
    ok: true,
    product: {
      ...product,
      variants: {
        edges: product.variants.edges.map((edge, index) => ({
          node: {
            ...edge.node,
            title: `${SHIRT_SIZES[index] || "S"} / Black`,
            price,
          },
        })),
      },
    },
    variantCount: 1 + (variantsPayload?.productVariants?.length || 0),
  };
};

export default function Index() {
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.ok) {
      shopify.toast.show("TKO forged shirt created as a draft");
    }
  }, [fetcher.data, shopify]);

  return (
    <s-page heading="TKO Forge Fulfillment">
      <s-section heading="Create a draft T-shirt">
        <s-paragraph>
          Turn an approved TKO artifact into a Shopify product. The product stays
          unpublished until its print provider, mockup, and production cost are approved.
        </s-paragraph>
        <fetcher.Form method="post">
          <div style={{ display: "grid", gap: 16, marginTop: 16, maxWidth: 720 }}>
            <label>
              <span>Product title</span>
              <input name="title" required minLength={3} maxLength={120} defaultValue="TKO Forged Creator Shirt" />
            </label>
            <label>
              <span>TKO artifact ID</span>
              <input name="artifactId" required placeholder="creator-artifact-id" />
            </label>
            <label>
              <span>TKO creator or clan ID</span>
              <input name="creatorId" required placeholder="TKO profile or clan UUID" />
            </label>
            <label>
              <span>Creator or clan handle</span>
              <input name="creatorHandle" required placeholder="@creator" />
            </label>
            <label>
              <span>Approved artwork HTTPS URL</span>
              <input name="artworkUrl" type="url" required placeholder="https://cdn.tko.cam/artwork/design.png" />
            </label>
            <label>
              <span>Retail price (USD)</span>
              <input name="priceDollars" type="number" required min="20" max="150" step="0.01" defaultValue="29.99" />
            </label>
            <div>
              <s-button type="submit" variant="primary" {...(isSubmitting ? { loading: true } : {})}>
                Create draft shirt
              </s-button>
            </div>
          </div>
        </fetcher.Form>
      </s-section>

      {fetcher.data && !fetcher.data.ok && (
        <s-section heading="Could not create the shirt">
          <s-unordered-list>
            {fetcher.data.errors.map((error) => <s-list-item key={error}>{error}</s-list-item>)}
          </s-unordered-list>
        </s-section>
      )}

      {fetcher.data?.ok && (
        <s-section heading="Draft created">
          <s-paragraph>
            {fetcher.data.product.title} has {fetcher.data.variantCount} Black size
            variants and remains in {fetcher.data.product.status} status.
          </s-paragraph>
          <s-button
            onClick={() => {
              shopify.intents.invoke?.("edit:shopify/Product", {
                value: fetcher.data?.ok ? fetcher.data.product.id : undefined,
              });
            }}
            variant="secondary"
          >
            Open Shopify product
          </s-button>
        </s-section>
      )}

      <s-section slot="aside" heading="Safety gates">
        <s-unordered-list>
          <s-list-item>Draft-only product creation</s-list-item>
          <s-list-item>Public HTTPS artwork required</s-list-item>
          <s-list-item>$20–$150 price boundary</s-list-item>
          <s-list-item>TKO creator and artifact provenance</s-list-item>
          <s-list-item>Provider mapping required before publish</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
