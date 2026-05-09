"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type ProviderId =
  | "swiggy-instamart"
  | "swiggy-food"
  | "swiggy-dineout"
  | "zepto";
type DebugAction = "search" | "your_go_to_items" | "report_error";

type AddressItem = {
  id: string;
  addressLine: string;
  addressTag?: string;
  lat?: number;
  lng?: number;
};

type LabState = {
  provider: ProviderId;
  providerLabel: string;
  slug: string;
  hasTokens: boolean;
  addressesResult:
    | {
        status: "ready";
        addresses: AddressItem[];
      }
    | {
        status: "auth_required";
        authReason?: string;
      }
    | {
        status: "unavailable";
        reason: string;
      };
  snapshot: unknown;
};

type SearchState = {
  provider: ProviderId;
  providerLabel: string;
  slug: string;
  result:
    | {
        status: "ready";
        payload: unknown;
        normalized?: unknown;
        meta?: unknown;
      }
    | {
        status: "auth_required";
        authReason?: string;
      }
    | {
        status: "unavailable";
        reason: string;
      };
  snapshot: unknown;
};

type ReportLinkPayload = {
  success?: boolean;
  data?: {
    reportLink?: string;
    supportEmail?: string;
    summary?: string;
  };
};

const PROVIDERS: Array<{ id: ProviderId; label: string }> = [
  { id: "swiggy-instamart", label: "Swiggy Instamart" },
  { id: "swiggy-food", label: "Swiggy Food" },
  { id: "swiggy-dineout", label: "Swiggy Dineout" },
  { id: "zepto", label: "Zepto" },
];

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <section
      style={{
        border: "1px solid #d9d2c3",
        borderRadius: 16,
        padding: 16,
        background: "#fffdf9",
      }}
    >
      <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>{title}</h3>
      <pre
        style={{
          margin: 0,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontSize: 12,
          lineHeight: 1.5,
          color: "#3f372f",
        }}
      >
        {JSON.stringify(value, null, 2)}
      </pre>
    </section>
  );
}

function extractReportLink(value: unknown) {
  const payload = value as ReportLinkPayload | null;
  const reportLink = payload?.data?.reportLink;
  const supportEmail = payload?.data?.supportEmail;
  const summary = payload?.data?.summary;

  if (!reportLink || typeof reportLink !== "string") {
    return null;
  }

  return {
    reportLink,
    supportEmail: typeof supportEmail === "string" ? supportEmail : null,
    summary: typeof summary === "string" ? summary : null,
  };
}

export default function SwiggyLabPage() {
  const [slug, setSlug] = useState("swiggy-lab");
  const [provider, setProvider] = useState<ProviderId>("swiggy-instamart");
  const [action, setAction] = useState<DebugAction>("search");
  const [query, setQuery] = useState("fruit");
  const [reportTool, setReportTool] = useState("search_products");
  const [reportFlowDescription, setReportFlowDescription] = useState(
    "User searched for spinach at a saved Bangalore address, but search_products returned 0 products while your_go_to_items succeeded in the same authenticated session.",
  );
  const [reportUserNotes, setReportUserNotes] = useState(
    "This appears to be specific to Instamart search_products rather than a general auth or address issue.",
  );
  const [reportToolContext, setReportToolContext] = useState(
    JSON.stringify(
      {
        addressId: "133337179",
        query: "spinach",
        comparativeProbe: "your_go_to_items returned products in same session",
      },
      null,
      2,
    ),
  );
  const [selectedAddressId, setSelectedAddressId] = useState("");
  const [labState, setLabState] = useState<LabState | null>(null);
  const [searchState, setSearchState] = useState<SearchState | null>(null);
  const [loadingState, setLoadingState] = useState(false);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedAddress = useMemo(() => {
    const addresses =
      labState?.addressesResult.status === "ready"
        ? labState.addressesResult.addresses
        : [];
    return addresses.find((address) => address.id === selectedAddressId) ?? null;
  }, [labState, selectedAddressId]);

  const reportLinkState = useMemo(
    () => extractReportLink(searchState?.result.status === "ready" ? searchState.result.payload : null),
    [searchState],
  );

  const availableActions = useMemo<Array<{ id: DebugAction; label: string }>>(() => {
    if (provider === "swiggy-instamart") {
      return [
        { id: "search", label: "search_products" },
        { id: "your_go_to_items", label: "your_go_to_items" },
        { id: "report_error", label: "report_error" },
      ];
    }
    return [{ id: "search", label: "search" }];
  }, [provider]);

  const queryLabel =
    action === "report_error"
      ? "Error message"
      : action === "your_go_to_items"
        ? "Optional note"
        : "Query";

  const queryPlaceholder =
    action === "report_error"
      ? "search_products returned 0 products for spinach at New Home"
      : action === "your_go_to_items"
        ? "Optional note for your own tracking"
        : "fruit";

  useEffect(() => {
    if (!availableActions.some((item) => item.id === action)) {
      setAction(availableActions[0]?.id ?? "search");
    }
  }, [action, availableActions]);

  async function loadProviderState() {
    setLoadingState(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/debug/swiggy-lab?provider=${encodeURIComponent(provider)}&slug=${encodeURIComponent(
          slug.trim().toLowerCase(),
        )}`,
      );
      const payload = (await response.json()) as LabState | { error?: string };
      if (!response.ok) {
        throw new Error(
          "error" in payload && payload.error ? payload.error : "Failed to load provider state.",
        );
      }
      const nextState = payload as LabState;
      setLabState(nextState);
      setSearchState(null);
      const addresses =
        nextState.addressesResult.status === "ready"
          ? nextState.addressesResult.addresses
          : [];
      setSelectedAddressId((current) => current || addresses[0]?.id || "");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load provider state.");
    } finally {
      setLoadingState(false);
    }
  }

  async function runSearch() {
    setLoadingSearch(true);
    setError(null);
    try {
      let parsedToolContext: Record<string, unknown> | null = null;
      if (action === "report_error" && reportToolContext.trim()) {
        try {
          const parsed = JSON.parse(reportToolContext) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            parsedToolContext = parsed as Record<string, unknown>;
          } else {
            throw new Error("toolContext must be a JSON object.");
          }
        } catch (parseError) {
          throw new Error(
            parseError instanceof Error
              ? `Invalid toolContext JSON: ${parseError.message}`
              : "Invalid toolContext JSON.",
          );
        }
      }

      const response = await fetch("/api/debug/swiggy-lab", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider,
          slug: slug.trim().toLowerCase(),
          action,
          query,
          report:
            action === "report_error"
              ? {
                  tool: reportTool,
                  flowDescription: reportFlowDescription,
                  userNotes: reportUserNotes,
                  toolContext: parsedToolContext,
                }
              : null,
          addressId: selectedAddressId || null,
          latitude: selectedAddress?.lat ?? null,
          longitude: selectedAddress?.lng ?? null,
        }),
      });
      const payload = (await response.json()) as SearchState | { error?: string };
      if (!response.ok) {
        throw new Error(
          "error" in payload && payload.error ? payload.error : "Search request failed.",
        );
      }
      setSearchState(payload as SearchState);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Search request failed.");
    } finally {
      setLoadingSearch(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #f6f1e7 0%, #efe7d8 100%)",
        color: "#221d17",
        padding: "32px 20px 48px",
      }}
    >
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ marginBottom: 24 }}>
          <p style={{ margin: 0, fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: "#7a6a58" }}>
            Internal Tool
          </p>
          <h1 style={{ margin: "8px 0 12px", fontSize: 36, lineHeight: 1.1 }}>
            Swiggy Lab
          </h1>
          <p style={{ margin: 0, maxWidth: 760, color: "#5e5347" }}>
            Authorize Swiggy providers, choose an address, run a plain-text query, and inspect the
            raw response plus normalized output. This bypasses the chat flow so you can see exactly
            what Swiggy returns.
          </p>
        </div>

        <section
          style={{
            display: "grid",
            gap: 16,
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            marginBottom: 20,
            padding: 20,
            borderRadius: 20,
            background: "rgba(255,255,255,0.72)",
            border: "1px solid #ddd0bc",
          }}
        >
          <label style={{ display: "grid", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Slug</span>
            <input
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              style={{
                borderRadius: 12,
                border: "1px solid #ccbda7",
                padding: "12px 14px",
                fontSize: 14,
                background: "#fffdf9",
              }}
            />
          </label>

          <label style={{ display: "grid", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Provider</span>
            <select
              value={provider}
              onChange={(event) => setProvider(event.target.value as ProviderId)}
              style={{
                borderRadius: 12,
                border: "1px solid #ccbda7",
                padding: "12px 14px",
                fontSize: 14,
                background: "#fffdf9",
              }}
            >
              {PROVIDERS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: "grid", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Action</span>
            <select
              value={action}
              onChange={(event) => setAction(event.target.value as DebugAction)}
              style={{
                borderRadius: 12,
                border: "1px solid #ccbda7",
                padding: "12px 14px",
                fontSize: 14,
                background: "#fffdf9",
              }}
            >
              {availableActions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: "grid", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{queryLabel}</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={queryPlaceholder}
              style={{
                borderRadius: 12,
                border: "1px solid #ccbda7",
                padding: "12px 14px",
                fontSize: 14,
                background: "#fffdf9",
              }}
            />
          </label>

          {action === "report_error" ? (
            <>
              <label style={{ display: "grid", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Failed tool</span>
                <input
                  value={reportTool}
                  onChange={(event) => setReportTool(event.target.value)}
                  style={{
                    borderRadius: 12,
                    border: "1px solid #ccbda7",
                    padding: "12px 14px",
                    fontSize: 14,
                    background: "#fffdf9",
                  }}
                />
              </label>

              <label style={{ display: "grid", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Flow description</span>
                <textarea
                  value={reportFlowDescription}
                  onChange={(event) => setReportFlowDescription(event.target.value)}
                  rows={4}
                  style={{
                    borderRadius: 12,
                    border: "1px solid #ccbda7",
                    padding: "12px 14px",
                    fontSize: 14,
                    background: "#fffdf9",
                    resize: "vertical",
                  }}
                />
              </label>

              <label style={{ display: "grid", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>User notes</span>
                <textarea
                  value={reportUserNotes}
                  onChange={(event) => setReportUserNotes(event.target.value)}
                  rows={3}
                  style={{
                    borderRadius: 12,
                    border: "1px solid #ccbda7",
                    padding: "12px 14px",
                    fontSize: 14,
                    background: "#fffdf9",
                    resize: "vertical",
                  }}
                />
              </label>

              <label style={{ display: "grid", gap: 8, gridColumn: "1 / -1" }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>toolContext JSON</span>
                <textarea
                  value={reportToolContext}
                  onChange={(event) => setReportToolContext(event.target.value)}
                  rows={8}
                  style={{
                    borderRadius: 12,
                    border: "1px solid #ccbda7",
                    padding: "12px 14px",
                    fontSize: 13,
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    background: "#fffdf9",
                    resize: "vertical",
                  }}
                />
              </label>
            </>
          ) : null}

          <div style={{ display: "flex", alignItems: "end", gap: 12, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={loadProviderState}
              disabled={loadingState}
              style={{
                borderRadius: 999,
                border: 0,
                padding: "12px 18px",
                fontSize: 14,
                fontWeight: 600,
                background: "#1f6feb",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              {loadingState ? "Loading..." : "Load provider state"}
            </button>
            <Link
              href={`/api/grocery/connect?slug=${encodeURIComponent(slug.trim().toLowerCase())}&provider=${encodeURIComponent(provider)}`}
              style={{
                borderRadius: 999,
                padding: "12px 18px",
                fontSize: 14,
                fontWeight: 600,
                background: "#0b8f55",
                color: "#fff",
                textDecoration: "none",
              }}
            >
              Authorize {PROVIDERS.find((item) => item.id === provider)?.label}
            </Link>
            <button
              type="button"
              onClick={runSearch}
              disabled={loadingSearch}
              style={{
                borderRadius: 999,
                border: "1px solid #342d25",
                padding: "12px 18px",
                fontSize: 14,
                fontWeight: 600,
                background: "#fffdf9",
                color: "#221d17",
                cursor: "pointer",
              }}
            >
              {loadingSearch
                ? "Running..."
                : action === "search"
                  ? "Run search"
                  : action === "your_go_to_items"
                    ? "Run go-to-items probe"
                    : "Send error report"}
            </button>
          </div>
        </section>

        {error ? (
          <p
            style={{
              margin: "0 0 16px",
              padding: "14px 16px",
              borderRadius: 14,
              background: "#fff1ef",
              border: "1px solid #f0b7ae",
              color: "#8a2415",
            }}
          >
            {error}
          </p>
        ) : null}

        <section
          style={{
            display: "grid",
            gap: 16,
            gridTemplateColumns: "minmax(280px, 360px) minmax(0, 1fr)",
            alignItems: "start",
          }}
        >
          <div
            style={{
              borderRadius: 20,
              padding: 20,
              background: "rgba(255,255,255,0.72)",
              border: "1px solid #ddd0bc",
            }}
          >
            <h2 style={{ margin: "0 0 12px", fontSize: 18 }}>Addresses</h2>
            {labState?.addressesResult.status === "ready" ? (
              <div style={{ display: "grid", gap: 10, maxHeight: 620, overflow: "auto" }}>
                {labState.addressesResult.addresses.map((address) => (
                  <label
                    key={address.id}
                    style={{
                      display: "grid",
                      gap: 4,
                      border: "1px solid #d9d2c3",
                      borderRadius: 14,
                      padding: 12,
                      background: selectedAddressId === address.id ? "#fff6df" : "#fffdf9",
                    }}
                  >
                    <span style={{ display: "flex", gap: 8, alignItems: "start" }}>
                      <input
                        type="radio"
                        name="selectedAddress"
                        checked={selectedAddressId === address.id}
                        onChange={() => setSelectedAddressId(address.id)}
                      />
                      <span>
                        <strong>{address.addressTag ?? address.id}</strong>
                        <br />
                        <span style={{ color: "#5e5347", fontSize: 13 }}>{address.addressLine}</span>
                        <br />
                        <span style={{ color: "#7a6a58", fontSize: 12 }}>
                          {typeof address.lat === "number" && typeof address.lng === "number"
                            ? `${address.lat}, ${address.lng}`
                            : "No coordinates exposed"}
                        </span>
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            ) : labState?.addressesResult.status === "auth_required" ? (
              <p style={{ margin: 0, color: "#8a2415" }}>Authorization required.</p>
            ) : labState?.addressesResult.status === "unavailable" ? (
              <p style={{ margin: 0, color: "#8a2415" }}>{labState.addressesResult.reason}</p>
            ) : (
              <p style={{ margin: 0, color: "#5e5347" }}>Load provider state to see saved addresses.</p>
            )}
          </div>

          <div style={{ display: "grid", gap: 16 }}>
            {reportLinkState ? (
              <section
                style={{
                  border: "1px solid #d9d2c3",
                  borderRadius: 16,
                  padding: 16,
                  background: "#fffdf9",
                  display: "grid",
                  gap: 12,
                }}
              >
                <h3 style={{ margin: 0, fontSize: 16 }}>Report action</h3>
                <p style={{ margin: 0, color: "#5e5347", fontSize: 14 }}>
                  Swiggy returned a pre-filled email link for this error report.
                </p>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <a
                    href={reportLinkState.reportLink}
                    style={{
                      borderRadius: 999,
                      padding: "12px 18px",
                      fontSize: 14,
                      fontWeight: 600,
                      background: "#8f3f0b",
                      color: "#fff",
                      textDecoration: "none",
                    }}
                  >
                    Open email draft
                  </a>
                  {reportLinkState.supportEmail ? (
                    <span style={{ alignSelf: "center", color: "#5e5347", fontSize: 13 }}>
                      Support: {reportLinkState.supportEmail}
                    </span>
                  ) : null}
                </div>
                {reportLinkState.summary ? (
                  <pre
                    style={{
                      margin: 0,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      fontSize: 12,
                      lineHeight: 1.5,
                      color: "#3f372f",
                      background: "#f7f1e8",
                      borderRadius: 12,
                      padding: 12,
                    }}
                  >
                    {reportLinkState.summary}
                  </pre>
                ) : null}
              </section>
            ) : null}
            <JsonBlock
              title="Provider state"
              value={
                labState ?? {
                  note: "No provider state loaded yet.",
                }
              }
            />
            <JsonBlock
              title="Tool schemas"
              value={
                labState && typeof labState.snapshot === "object" && labState.snapshot !== null
                  ? (labState.snapshot as { toolSchemas?: unknown }).toolSchemas ?? {
                      note: "No tool schemas captured yet. Load provider state first.",
                    }
                  : {
                      note: "No tool schemas captured yet. Load provider state first.",
                    }
              }
            />
            <JsonBlock
              title="Probe response"
              value={
                searchState ?? {
                  note: "No probe run yet.",
                }
              }
            />
          </div>
        </section>
      </div>
    </main>
  );
}
