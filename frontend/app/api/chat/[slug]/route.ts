import { NextResponse } from "next/server";
import {
  getOrCreateChatSession,
  processChatMessage,
} from "@/lib/chat-engine";
import { runWithTrace, traceError, traceEvent } from "@/lib/debug-trace";

type RouteContext = {
  params: Promise<{
    slug: string;
  }>;
};

export async function GET(_: Request, context: RouteContext) {
  const { slug } = await context.params;
  return runWithTrace(
    {
      slug,
      route: "GET /api/chat/[slug]",
    },
    async () => {
      traceEvent("chat-route", "session_get", { slug });
      return NextResponse.json(getOrCreateChatSession(slug));
    },
  );
}

export async function POST(request: Request, context: RouteContext) {
  const { slug } = await context.params;
  const body = (await request.json()) as { text?: string };
  const text = body.text?.trim();

  if (!text) {
    return NextResponse.json(
      { error: "Message text is required." },
      { status: 400 },
    );
  }

  return runWithTrace(
    {
      slug,
      route: "POST /api/chat/[slug]",
    },
    async () => {
      traceEvent("chat-route", "message_received", {
        slug,
        text,
      });

      try {
        const session = await processChatMessage(slug, text);
        traceEvent("chat-route", "message_completed", {
          slug,
          stage: session.stage,
          messageCount: session.messages.length,
          lastAssistantType:
            [...session.messages].reverse().find((message) => message.role === "assistant")?.type ?? "",
        });
        return NextResponse.json(session);
      } catch (error) {
        traceError("chat-route", "message_failed", error, { slug, text });
        throw error;
      }
    },
  );
}
