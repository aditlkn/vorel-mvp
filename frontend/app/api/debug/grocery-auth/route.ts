import { NextResponse } from "next/server";
import {
  listGroceryAuthEvents,
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

  return NextResponse.json({
    events: listGroceryAuthEvents(isProvider(provider) ? provider : undefined, slug),
  });
}
