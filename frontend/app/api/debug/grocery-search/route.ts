import { NextResponse } from "next/server";
import {
  getDebugSnapshot,
  type GroceryProviderId,
} from "@/lib/grocery-provider";

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
  const provider = searchParams.get("provider");
  const slug = searchParams.get("slug")?.trim().toLowerCase();

  if (!slug || !isProvider(provider)) {
    return NextResponse.json(
      { error: "provider and slug are required" },
      { status: 400 },
    );
  }

  return NextResponse.json({
    snapshot: getDebugSnapshot(provider, slug),
  });
}
