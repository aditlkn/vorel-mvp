import { NextResponse } from "next/server";
import {
  getGroceryOrderDetails,
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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("slug")?.trim().toLowerCase();
  const provider = searchParams.get("provider");
  const orderId = searchParams.get("orderId")?.trim();

  if (!slug || !orderId || !isProvider(provider)) {
    return NextResponse.json(
      { error: "Missing slug, provider, or orderId." },
      { status: 400 },
    );
  }

  const result = await getGroceryOrderDetails(provider, slug, orderId);
  if (result.status === "ready") {
    return NextResponse.json(result);
  }
  if (result.status === "auth_required") {
    return NextResponse.json(result, { status: 401 });
  }
  return NextResponse.json(result, { status: 500 });
}
