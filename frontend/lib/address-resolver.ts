import type { GroceryProviderId, SavedAddress } from "@/lib/grocery";

export type ProviderAddressGroup = {
  provider: GroceryProviderId;
  addresses: SavedAddress[];
};

export type ResolvedAddress = SavedAddress & {
  providerIds: Partial<Record<GroceryProviderId, string>>;
  matchedProviders: GroceryProviderId[];
  confidence: number;
};

type AddressProfile = {
  normalized: string;
  tokens: string[];
  tokenSet: Set<string>;
  pincode: string | null;
  unit: string | null;
};

const ADDRESS_STOPWORDS = new Set([
  "address",
  "area",
  "bangalore",
  "bengaluru",
  "block",
  "building",
  "cross",
  "floor",
  "ground",
  "home",
  "india",
  "indian",
  "karnataka",
  "layout",
  "main",
  "near",
  "no",
  "number",
  "rd",
  "road",
  "st",
  "street",
  "ward",
]);

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeAddressLine(value: string) {
  return normalizeWhitespace(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\b0+(\d+)/g, "$1"),
  );
}

function extractPincode(value: string) {
  return value.match(/\b\d{6}\b/)?.[0] ?? null;
}

function extractUnit(value: string) {
  const match = value
    .toLowerCase()
    .match(/\b([a-z]{1,3}\s*[-]?\s*\d{1,4}[a-z]?)\b/);

  return match ? match[1].replace(/\s+/g, "") : null;
}

function tokenizeAddress(value: string) {
  return normalizeAddressLine(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(
      (token) =>
        token &&
        !ADDRESS_STOPWORDS.has(token) &&
        (token.length > 2 || /^\d+$/.test(token)),
    );
}

function buildProfile(address: SavedAddress): AddressProfile {
  const normalized = normalizeAddressLine(address.addressLine);
  const tokens = tokenizeAddress(address.addressLine);
  return {
    normalized,
    tokens,
    tokenSet: new Set(tokens),
    pincode: extractPincode(address.addressLine),
    unit: extractUnit(address.addressLine),
  };
}

function intersectionCount(a: Set<string>, b: Set<string>) {
  let count = 0;
  for (const token of a) {
    if (b.has(token)) {
      count += 1;
    }
  }
  return count;
}

function scoreProfiles(a: AddressProfile, b: AddressProfile) {
  let score = 0;

  if (a.pincode && b.pincode) {
    score += a.pincode === b.pincode ? 10 : -8;
  }

  if (a.unit && b.unit) {
    score += a.unit === b.unit ? 8 : -2;
  }

  const sharedTokens = intersectionCount(a.tokenSet, b.tokenSet);
  const unionSize = new Set([...a.tokens, ...b.tokens]).size || 1;
  const jaccard = sharedTokens / unionSize;

  score += sharedTokens * 2;
  score += Math.round(jaccard * 10);

  if (
    a.normalized.includes(b.normalized) ||
    b.normalized.includes(a.normalized)
  ) {
    score += 4;
  }

  return score;
}

function buildClusterId(addresses: SavedAddress[]) {
  const representative = [...addresses].sort(
    (a, b) => b.addressLine.length - a.addressLine.length,
  )[0];
  return normalizeAddressLine(representative.addressLine);
}

function buildClusterLabel(addresses: SavedAddress[]) {
  return [...addresses].sort((a, b) => b.addressLine.length - a.addressLine.length)[0]
    .addressLine;
}

export function resolveAddressOptions(
  groups: ProviderAddressGroup[],
): ResolvedAddress[] {
  const clusters: Array<{
    addresses: SavedAddress[];
    providers: Set<GroceryProviderId>;
    providerIds: Partial<Record<GroceryProviderId, string>>;
    scores: number[];
  }> = [];

  for (const group of groups) {
    for (const address of group.addresses) {
      const profile = buildProfile(address);
      let bestClusterIndex = -1;
      let bestScore = Number.NEGATIVE_INFINITY;

      clusters.forEach((cluster, index) => {
        if (cluster.providers.has(group.provider)) {
          return;
        }

        const scores = cluster.addresses.map((candidate) =>
          scoreProfiles(profile, buildProfile(candidate)),
        );
        const averageScore =
          scores.reduce((sum, value) => sum + value, 0) / scores.length;

        if (averageScore > bestScore) {
          bestScore = averageScore;
          bestClusterIndex = index;
        }
      });

      if (bestClusterIndex >= 0 && bestScore >= 12) {
        const cluster = clusters[bestClusterIndex];
        cluster.addresses.push(address);
        cluster.providers.add(group.provider);
        cluster.providerIds[group.provider] = address.id;
        cluster.scores.push(bestScore);
      } else {
        clusters.push({
          addresses: [address],
          providers: new Set([group.provider]),
          providerIds: { [group.provider]: address.id },
          scores: [],
        });
      }
    }
  }

  return clusters
    .map((cluster) => {
      const representative = [...cluster.addresses].sort(
        (a, b) => b.addressLine.length - a.addressLine.length,
      )[0];
      return {
        id: buildClusterId(cluster.addresses),
        addressLine: buildClusterLabel(cluster.addresses),
        addressTag: representative.addressTag,
        lat: representative.lat,
        lng: representative.lng,
        providerIds: cluster.providerIds,
        matchedProviders: [...cluster.providers],
        confidence:
          cluster.scores.length > 0
            ? Math.round(
                cluster.scores.reduce((sum, value) => sum + value, 0) /
                  cluster.scores.length,
              )
            : 0,
      };
    })
    .sort((a, b) => {
      return (
        b.matchedProviders.length - a.matchedProviders.length ||
        b.confidence - a.confidence ||
        a.addressLine.localeCompare(b.addressLine)
      );
    });
}

export function resolveProviderAddressId(
  selectedAddress: ResolvedAddress | SavedAddress | null,
  provider: GroceryProviderId,
  providerAddresses: SavedAddress[],
) {
  if (!selectedAddress) {
    return null;
  }

  if ("providerIds" in selectedAddress) {
    const mappedId = selectedAddress.providerIds[provider];
    if (mappedId) {
      return mappedId;
    }
  }

  const selectedProfile = buildProfile(selectedAddress);
  const ranked = providerAddresses
    .map((address) => ({
      id: address.id,
      score: scoreProfiles(selectedProfile, buildProfile(address)),
    }))
    .sort((a, b) => b.score - a.score);

  return ranked[0] && ranked[0].score >= 12 ? ranked[0].id : null;
}

export function resolveResolvedAddress(
  selectedAddress: ResolvedAddress | SavedAddress | null,
  resolvedAddresses: ResolvedAddress[],
) {
  if (!selectedAddress) {
    return null;
  }

  const selectedProfile = buildProfile(selectedAddress);
  const ranked = resolvedAddresses
    .map((address) => ({
      address,
      score: scoreProfiles(selectedProfile, buildProfile(address)),
    }))
    .sort((a, b) => b.score - a.score);

  return ranked[0] && ranked[0].score >= 12 ? ranked[0].address : null;
}
