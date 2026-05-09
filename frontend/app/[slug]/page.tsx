import { ChatShell } from "@/components";
import {
  getOrCreateChatSessionWithMode,
  type EntryMode,
} from "@/lib/chat-engine";

type SlugPageProps = {
  params: Promise<{
    slug: string;
  }>;
  searchParams: Promise<{
    mode?: string;
  }>;
};

function parseEntryMode(mode: string | undefined): EntryMode {
  switch (mode) {
    case "cook-dinner":
    case "grocery-shopping":
    case "eat-out":
    case "meal-plan":
    case "free-text":
      return mode;
    default:
      return "free-text";
  }
}

export default async function SlugPage({ params, searchParams }: SlugPageProps) {
  const { slug } = await params;
  const { mode } = await searchParams;
  const session = getOrCreateChatSessionWithMode(slug, parseEntryMode(mode));

  return <ChatShell session={session} />;
}
