import { NextResponse } from "next/server";
import { beginGroceryAuth } from "@/lib/grocery";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("slug")?.trim().toLowerCase();

  if (!slug) {
    return NextResponse.json(
      { error: "Missing slug for Swiggy connect." },
      { status: 400 },
    );
  }

  try {
    const authUrl = await beginGroceryAuth("swiggy-instamart", slug);
    return NextResponse.redirect(authUrl);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to start Swiggy auth.",
      },
      { status: 500 },
    );
  }
}
