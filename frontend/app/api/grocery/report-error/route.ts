import { NextResponse } from "next/server";
import {
  reportGroceryProviderError,
  type GroceryProviderId,
} from "@/lib/grocery";

function isProvider(value: string | null): value is GroceryProviderId {
  return (
    value === "swiggy-instamart" ||
    value === "zepto" ||
    value === "swiggy-food" ||
    value === "swiggy-dineout"
  );
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    slug?: string;
    provider?: GroceryProviderId;
    message?: string;
    context?: Record<string, unknown>;
  };

  const slug = body.slug?.trim().toLowerCase();
  const message = body.message?.trim();
  const provider = isProvider(body.provider ?? null) ? body.provider : null;

  if (!slug || !message || !provider) {
    return NextResponse.json(
      { error: "Missing slug, provider, or message." },
      { status: 400 },
    );
  }

  const result = await reportGroceryProviderError(
    provider,
    slug,
    message,
    body.context,
  );

  if (result.status === "ready") {
    return NextResponse.json(result);
  }
  if (result.status === "auth_required") {
    return NextResponse.json(result, { status: 401 });
  }
  return NextResponse.json(result, { status: 500 });
}
