import { NextResponse } from "next/server";
import { listTraceEvents, summarizeTraceEvents } from "@/lib/debug-trace";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("slug")?.trim().toLowerCase();
  const traceId = searchParams.get("traceId")?.trim();
  const limitValue = searchParams.get("limit");
  const limit = limitValue ? Number(limitValue) : undefined;

  const events = listTraceEvents({
    slug,
    traceId,
    limit: Number.isFinite(limit) ? limit : undefined,
  });

  return NextResponse.json({
    summary: summarizeTraceEvents(events),
    events,
  });
}
