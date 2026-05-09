"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type EntryMode = "cook-dinner" | "grocery-shopping" | "eat-out" | "meal-plan" | "free-text";

const sampleSlugs = ["adnan", "maya-kitchen", "weeknight-demo"];

const entryOptions: Array<{
  mode: Exclude<EntryMode, "free-text">;
  eyebrow: string;
  title: string;
  detail: string;
  firstStep: string;
  payoff: string;
}> = [
  {
    mode: "cook-dinner",
    eyebrow: "Cook tonight",
    title: "Cook dinner tonight",
    detail: "Start from cravings, time, diet, and what you already have at home.",
    firstStep: "First question: what you feel like eating, what’s already in the kitchen, and how much time you have.",
    payoff: "You get recipe picks, pantry-aware missing ingredients, and a live cart if you need groceries.",
  },
  {
    mode: "grocery-shopping",
    eyebrow: "Shop faster",
    title: "Shop for groceries",
    detail: "Build a shopping flow around a list, pantry gaps, and provider preferences.",
    firstStep: "First question: your list, brand preferences, and whether you want Instamart or Zepto.",
    payoff: "You get a live provider cart instead of a recipe conversation.",
  },
  {
    mode: "eat-out",
    eyebrow: "Eat out or order in",
    title: "Find somewhere to eat",
    detail: "Start with cuisine, area, budget, and what kind of place you want tonight.",
    firstStep: "First question: delivery or go out, then cuisine, dish, or vibe.",
    payoff: "You get either delivery restaurants or bookable dine-out options.",
  },
  {
    mode: "meal-plan",
    eyebrow: "Plan ahead",
    title: "Plan meals for the week or a party",
    detail: "Start with people, days, diet, prep constraints, and a broader planning goal.",
    firstStep: "First question: week or party, then people, meal count, and constraints.",
    payoff: "You get a multi-meal plan, not a single dinner suggestion.",
  },
];

function normalizeSlugInput(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "guest"
  );
}

function buildSessionHref(slug: string, mode: EntryMode) {
  const normalizedSlug = normalizeSlugInput(slug);
  if (mode === "free-text") {
    return `/${normalizedSlug}`;
  }
  return `/${normalizedSlug}?mode=${mode}`;
}

export default function Home() {
  const [slugValue, setSlugValue] = useState("weeknight-demo");
  const normalizedSlug = useMemo(() => normalizeSlugInput(slugValue), [slugValue]);

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f6f1e8_0%,#f1ebdf_100%)] px-6 py-14 text-stone-950">
      <div className="mx-auto max-w-5xl">
        <section className="rounded-[2rem] border border-stone-200 bg-white p-8 shadow-sm sm:p-10">
          <p className="font-serif text-4xl font-semibold tracking-tight">Vorel</p>
          <h1 className="mt-4 max-w-3xl text-5xl font-semibold tracking-tight text-balance">
            Choose how you want to start.
          </h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-stone-600">
            Each path changes the first questions, the ranking logic, and the outcome.
            Pick the lane that matches what you want done, or jump into free text and let
            Vorel route it.
          </p>

          <div className="mt-8 rounded-[1.5rem] border border-stone-200 bg-stone-50/80 p-4 sm:p-5">
            <label
              htmlFor="slug"
              className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500"
            >
              Chat slug
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              {sampleSlugs.map((slug) => (
                <button
                  key={slug}
                  type="button"
                  onClick={() => setSlugValue(slug)}
                  className={[
                    "rounded-full border px-3 py-2 text-sm transition",
                    normalizeSlugInput(slugValue) === slug
                      ? "border-stone-900 bg-stone-950 text-white"
                      : "border-stone-300 bg-white text-stone-700",
                  ].join(" ")}
                >
                  /{slug}
                </button>
              ))}
            </div>
            <input
              id="slug"
              value={slugValue}
              onChange={(event) => setSlugValue(event.target.value)}
              placeholder="enter a slug"
              className="mt-4 w-full rounded-[1.25rem] border border-stone-300 bg-white px-4 py-3 text-base text-stone-900 outline-none placeholder:text-stone-400"
            />
            <p className="mt-3 text-sm text-stone-500">Session will open at /{normalizedSlug}</p>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {entryOptions.map((option) => (
              <Link
                key={option.mode}
                href={buildSessionHref(slugValue, option.mode)}
                className="group rounded-[1.6rem] border border-stone-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-md"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                  {option.eyebrow}
                </p>
                <h2 className="mt-3 text-2xl font-semibold tracking-tight text-stone-950">
                  {option.title}
                </h2>
                <p className="mt-3 text-sm leading-7 text-stone-600">{option.detail}</p>
                <div className="mt-5 rounded-[1.15rem] bg-stone-50 px-4 py-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                    First step
                  </p>
                  <p className="mt-2 text-sm leading-6 text-stone-700">{option.firstStep}</p>
                  <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                    You’ll get
                  </p>
                  <p className="mt-2 text-sm leading-6 text-stone-700">{option.payoff}</p>
                </div>
                <p className="mt-5 text-sm font-medium text-stone-900">Open /{normalizedSlug}</p>
              </Link>
            ))}
          </div>

          <div className="mt-8 rounded-[1.6rem] border border-dashed border-stone-300 bg-white/70 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
              Free text
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-stone-950">
              Just start chatting
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-stone-600">
              Don’t want to choose a lane yet? Open a generic session and type
              anything. Vorel will still try to route the conversation from your
              first message.
            </p>
            <Link
              href={buildSessionHref(slugValue, "free-text")}
              className="mt-5 inline-flex rounded-full bg-stone-950 px-5 py-3 text-sm font-medium text-white"
            >
              Open free-form chat
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
