import { NextResponse } from "next/server";
import {
  getActiveCartProviders,
  getConnectedGroceryProviders,
  setActiveCartProviders,
} from "@/lib/grocery";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("slug")?.trim().toLowerCase();

  if (!slug) {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }

  return NextResponse.json({
    slug,
    activeCartProviders: getActiveCartProviders(slug),
    connectedCartProviders: getConnectedGroceryProviders(slug),
  });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    slug?: string;
    activeCartProviders?: string[];
  };

  const slug = body.slug?.trim().toLowerCase();
  if (!slug) {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }

  const activeCartProviders = setActiveCartProviders(
    slug,
    body.activeCartProviders ?? [],
  );

  return NextResponse.json({
    slug,
    activeCartProviders,
    connectedCartProviders: getConnectedGroceryProviders(slug),
  });
}
