import { NextResponse } from "next/server";
import {
  createGroceryAddress,
  deleteGroceryAddress,
  type AddressCreateInput,
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
    input?: AddressCreateInput;
  };

  const slug = body.slug?.trim().toLowerCase();
  const provider = isProvider(body.provider ?? null) ? body.provider : null;
  if (!slug || !provider || !body.input?.addressLine1) {
    return NextResponse.json(
      { error: "Missing slug, provider, or address input." },
      { status: 400 },
    );
  }

  const result = await createGroceryAddress(provider, slug, body.input);
  if (result.status === "ready") {
    return NextResponse.json(result);
  }
  if (result.status === "auth_required") {
    return NextResponse.json(result, { status: 401 });
  }
  return NextResponse.json(result, { status: 500 });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("slug")?.trim().toLowerCase();
  const provider = searchParams.get("provider");
  const addressId = searchParams.get("addressId")?.trim();

  if (!slug || !addressId || !isProvider(provider)) {
    return NextResponse.json(
      { error: "Missing slug, provider, or addressId." },
      { status: 400 },
    );
  }

  const result = await deleteGroceryAddress(provider, slug, addressId);
  if (result.status === "ready") {
    return NextResponse.json(result);
  }
  if (result.status === "auth_required") {
    return NextResponse.json(result, { status: 401 });
  }
  return NextResponse.json(result, { status: 500 });
}
