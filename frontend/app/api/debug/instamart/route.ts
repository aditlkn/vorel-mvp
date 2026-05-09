import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      error: "Instamart debug route is no longer available in this build.",
    },
    { status: 410 },
  );
}
