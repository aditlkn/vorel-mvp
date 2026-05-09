export type LoopGuardConfig<TItem> = {
  windowSize?: number;
  repeatThreshold?: number;
  consecutiveThreshold?: number;
  getSignature: (item: TItem) => string;
};

export type LoopDetectionResult = {
  looped: boolean;
  lastSignature: string | null;
  recentMatches: number;
  consecutiveMatches: number;
};

export function detectLoop<TItem>(
  items: TItem[],
  config: LoopGuardConfig<TItem>,
): LoopDetectionResult {
  const windowSize = config.windowSize ?? 6;
  const repeatThreshold = config.repeatThreshold ?? 3;
  const consecutiveThreshold = config.consecutiveThreshold ?? 3;

  const recentItems = items.slice(-windowSize);
  if (recentItems.length < consecutiveThreshold) {
    return {
      looped: false,
      lastSignature: null,
      recentMatches: 0,
      consecutiveMatches: 0,
    };
  }

  const signatures = recentItems.map((item) => config.getSignature(item));
  const lastSignature = signatures.at(-1) ?? null;

  if (!lastSignature) {
    return {
      looped: false,
      lastSignature: null,
      recentMatches: 0,
      consecutiveMatches: 0,
    };
  }

  const recentMatches = signatures.filter(
    (signature) => signature === lastSignature,
  ).length;

  let consecutiveMatches = 0;
  for (let index = signatures.length - 1; index >= 0; index -= 1) {
    if (signatures[index] !== lastSignature) {
      break;
    }
    consecutiveMatches += 1;
  }

  return {
    looped:
      consecutiveMatches >= consecutiveThreshold ||
      recentMatches >= repeatThreshold,
    lastSignature,
    recentMatches,
    consecutiveMatches,
  };
}
