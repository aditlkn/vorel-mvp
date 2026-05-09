import Link from "next/link";
import { redirect } from "next/navigation";
import { completeGroceryConnectForSession } from "@/lib/chat-engine";
import { getGroceryProviderLabel, type GroceryProviderId } from "@/lib/grocery";
import { recordGroceryAuthEvent } from "@/lib/grocery-provider";

type CallbackPageProps = {
  searchParams: Promise<{
    code?: string;
    state?: string;
    slug?: string;
    provider?: GroceryProviderId;
    error?: string;
    error_description?: string;
  }>;
};

export default async function CallbackPage({ searchParams }: CallbackPageProps) {
  const { code, state, slug, provider, error, error_description } =
    await searchParams;

  if (slug && provider) {
    recordGroceryAuthEvent({
      at: new Date().toISOString(),
      provider,
      slug: slug.trim().toLowerCase(),
      stage: "callback_received",
      detail: {
        hasCode: code ? "true" : "false",
        hasState: state ? "true" : "false",
        error: error ?? "",
        errorDescription: error_description ?? "",
      },
    });
  }

  if (!slug || !code || !provider) {
    if (slug && provider) {
      recordGroceryAuthEvent({
        at: new Date().toISOString(),
        provider,
        slug: slug.trim().toLowerCase(),
        stage: error ? "callback_error" : "callback_missing_fields",
        detail: {
          hasCode: code ? "true" : "false",
          hasState: state ? "true" : "false",
          error: error ?? "",
          errorDescription: error_description ?? "",
        },
      });
    }
    return (
      <main className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#f6f1e8_0%,#f1ebdf_100%)] px-6 text-stone-950">
        <div className="max-w-sm rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
          <h1 className="font-serif text-3xl font-semibold tracking-tight">
            Vorel
          </h1>
          <p className="mt-4 text-sm leading-6 text-stone-600">
            {error
              ? `Grocery auth returned an OAuth error: ${error}${error_description ? ` - ${error_description}` : ""}`
              : "Grocery auth did not return the fields Vorel needs to resume the chat."}
          </p>
          <Link
            href="/"
            className="mt-5 inline-flex rounded-full bg-stone-950 px-4 py-2 text-sm font-medium text-white"
          >
            Back home
          </Link>
        </div>
      </main>
    );
  }

  try {
    await completeGroceryConnectForSession(provider, slug, code, state ?? null);
    redirect(`/${slug}`);
  } catch (error) {
    recordGroceryAuthEvent({
      at: new Date().toISOString(),
      provider,
      slug: slug.trim().toLowerCase(),
      stage: "finish_auth_error",
      detail: {
        message:
          error instanceof Error
            ? error.message
            : `${getGroceryProviderLabel(provider)} auth could not be completed.`,
      },
    });
    return (
      <main className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#f6f1e8_0%,#f1ebdf_100%)] px-6 text-stone-950">
        <div className="max-w-sm rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
          <h1 className="font-serif text-3xl font-semibold tracking-tight">
            Vorel
          </h1>
          <p className="mt-4 text-sm leading-6 text-stone-600">
            {error instanceof Error
              ? error.message
              : `${getGroceryProviderLabel(provider)} auth could not be completed.`}
          </p>
          <Link
            href={`/${slug}`}
            className="mt-5 inline-flex rounded-full bg-stone-950 px-4 py-2 text-sm font-medium text-white"
          >
            Return to chat
          </Link>
        </div>
      </main>
    );
  }
}
