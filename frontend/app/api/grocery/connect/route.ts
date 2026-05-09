import { NextResponse } from "next/server";
import {
  beginGroceryAuth,
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
      { error: "Missing slug or provider for grocery connect." },
      { status: 400 },
    );
  }

  try {
    const authUrl = await beginGroceryAuth(provider, slug);
    return NextResponse.redirect(authUrl);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to start grocery auth.",
      },
      { status: 500 },
    );
  }
}
