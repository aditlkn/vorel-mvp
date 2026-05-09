import { NextResponse } from "next/server";
import {
  disconnectGroceryProvider,
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

  if (!slug || !isProvider(provider)) {
    return NextResponse.json(
      { error: "Missing slug or provider for grocery disconnect." },
      { status: 400 },
    );
  }

  const result = await disconnectGroceryProvider(provider, slug);
  if (result.status === "unavailable") {
    return NextResponse.json({ error: result.reason }, { status: 500 });
  }

  return NextResponse.redirect(new URL(`/${slug}`, request.url));
}
