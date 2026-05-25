import test from "node:test";
import assert from "node:assert/strict";
import { getMlsProvider, listMlsProviders } from "@/lib/mls/registry";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("registered MLS providers expose operator-facing metadata", () => {
  const providers = listMlsProviders();
  assert.ok(providers.some((provider) => provider.key === "manual-json"));
  assert.ok(providers.some((provider) => provider.key === "generic-reso-web-api"));
  assert.ok(providers.every((provider) => provider.label && provider.description && provider.configHelp));
});

test("manual JSON provider normalizes listings", async () => {
  const provider = getMlsProvider("manual-json");
  assert.ok(provider);

  const result = await provider.sync({
    id: "cfg_1",
    tenantId: "tenant_a",
    providerKey: provider.key,
    label: provider.label,
    config: {
      listings: [
        {
          externalId: "A123",
          address: "123 Main St, Atlanta, GA",
          city: "Atlanta",
          state: "GA",
          price: "$525,000",
          beds: "3",
          baths: "2.5",
        },
      ],
    },
  });

  assert.equal(result.imported, 1);
  assert.equal(result.listings[0]?.externalId, "A123");
  assert.equal(result.listings[0]?.price, 525000);
  assert.equal(result.listings[0]?.beds, 3);
  assert.equal(result.listings[0]?.baths, 2.5);
});

test("generic RESO provider reads OData rows and sends bearer token", async () => {
  let requestedUrl = "";
  let authHeader = "";
  globalThis.fetch = (async (input, init) => {
    requestedUrl = String(input);
    authHeader = new Headers(init?.headers).get("authorization") ?? "";
    return new Response(
      JSON.stringify({
        value: [
          {
            ListingKey: "LK-1",
            ListingId: "MLS-1",
            UnparsedAddress: "456 Oak Ave, Decatur, GA",
            City: "Decatur",
            StateOrProvince: "GA",
            ListPrice: 650000,
            BedroomsTotal: 4,
            BathroomsTotalDecimal: 3,
            LivingArea: 2400,
            StandardStatus: "Active",
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  const provider = getMlsProvider("generic-reso-web-api");
  assert.ok(provider);
  const result = await provider.sync({
    id: "cfg_1",
    tenantId: "tenant_a",
    providerKey: provider.key,
    label: provider.label,
    config: {
      baseUrl: "https://mls.example.test/reso/odata/Property",
      query: "$top=1",
    },
    secret: "token-123",
  });

  assert.equal(new URL(requestedUrl).searchParams.get("$top"), "1");
  assert.equal(authHeader, "Bearer token-123");
  assert.equal(result.imported, 1);
  assert.equal(result.listings[0]?.mlsNumber, "MLS-1");
  assert.equal(result.listings[0]?.priceDisplay, "$650,000");
});
