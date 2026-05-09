import { NextResponse } from "next/server";
import {
  getGroceryProviderLabel,
  hasGroceryTokens,
  listGroceryAddresses,
  runProviderDebugAction,
  type GroceryDebugAction,
  type GroceryDebugReportInput,
  type GroceryProviderId,
} from "@/lib/grocery";
import { getDebugSnapshot } from "@/lib/grocery-provider";

function isProvider(value: string | null): value is GroceryProviderId {
  return (
    value === "swiggy-instamart" ||
    value === "swiggy-food" ||
    value === "swiggy-dineout" ||
    value === "zepto"
  );
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const provider = searchParams.get("provider");
  const slug = searchParams.get("slug")?.trim().toLowerCase();

  if (!slug || !isProvider(provider)) {
    return NextResponse.json(
      { error: "provider and slug are required" },
      { status: 400 },
    );
  }

  const hasTokens = hasGroceryTokens(provider, slug);
  const addressesResult = await listGroceryAddresses(provider, slug);

  return NextResponse.json({
    provider,
    providerLabel: getGroceryProviderLabel(provider),
    slug,
    hasTokens,
    addressesResult,
    snapshot: getDebugSnapshot(provider, slug),
  });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    provider?: GroceryProviderId;
    slug?: string;
    action?: GroceryDebugAction;
    query?: string;
    report?: GroceryDebugReportInput | null;
    addressId?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    entityType?: string | null;
  };

  const provider = isProvider(body.provider ?? null) ? body.provider : null;
  const slug = body.slug?.trim().toLowerCase();
  const query = body.query?.trim();
  const action = body.action ?? "search";

  if (!provider || !slug) {
    return NextResponse.json(
      { error: "provider and slug are required" },
      { status: 400 },
    );
  }

  if (action === "search" && !query) {
    return NextResponse.json(
      { error: "query is required for search" },
      { status: 400 },
    );
  }

  const result = await runProviderDebugAction(
    provider,
    slug,
    action,
    query ?? null,
    body.report ?? null,
    body.addressId ?? null,
    body.latitude ?? null,
    body.longitude ?? null,
    body.entityType ?? null,
  );

  if (result.status === "ready") {
    return NextResponse.json({
      provider,
      providerLabel: getGroceryProviderLabel(provider),
      slug,
      result,
      snapshot: getDebugSnapshot(provider, slug),
    });
  }

  return NextResponse.json(
    {
      provider,
      providerLabel: getGroceryProviderLabel(provider),
      slug,
      result,
      snapshot: getDebugSnapshot(provider, slug),
    },
    { status: result.status === "auth_required" ? 401 : 500 },
  );
}
