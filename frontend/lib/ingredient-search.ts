const INGREDIENT_ALIASES: Record<string, string[]> = {
  spinach: ["palak"],
  coriander: ["cilantro", "dhania"],
  capsicum: ["bell pepper", "shimla mirch"],
  bell: ["capsicum"],
  chili: ["chilli", "mirchi"],
  chilies: ["chilli", "mirchi"],
  yogurt: ["curd", "dahi"],
  eggplant: ["brinjal", "baingan"],
  okra: ["bhindi"],
  mint: ["pudina"],
  scallion: ["spring onion", "green onion"],
  spring: ["scallion", "green onion"],
  cumin: ["jeera"],
  corn: ["sweet corn", "maize"],
  cottage: ["paneer"],
  cheese: ["paneer"],
  rice: ["basmati"],
  pepsi: ["soft drink", "cola"],
  coke: ["soft drink", "cola"],
  lay: ["chips", "potato chips"],
  lays: ["chips", "potato chips"],
  chocolate: ["chocolates"],
  perk: ["cadbury perk chocolate"],
};

const EXACT_QUERY_ALIASES: Record<string, string[]> = {
  "dairy milk": ["cadbury dairy milk chocolate", "dairy milk chocolate"],
  perk: ["cadbury perk chocolate", "perk chocolate"],
  pepsi: ["pepsi soft drink", "pepsi cola"],
  "pepsi regular": ["pepsi soft drink", "pepsi cola"],
  lays: ["lays chips", "potato chips"],
  "lays regular": ["lays chips", "potato chips"],
  "cold drinks": ["soft drink", "cola"],
  "cold drink": ["soft drink", "cola"],
  chocolates: ["chocolate"],
  chips: ["potato chips"],
  "plain curd": ["plain dahi", "plain yogurt", "curd"],
  "salted potato chips": ["classic salted chips", "potato chips", "lays chips"],
  "cola soft drink": ["pepsi soft drink", "coke soft drink", "cola"],
  "milk chocolate": ["dairy milk chocolate", "milk chocolate bar", "chocolate"],
};

const PLAIN_YOGURT_TOKENS = new Set(["yogurt", "curd", "dahi"]);
const FLAVORED_YOGURT_TOKENS = [
  "blueberry",
  "strawberry",
  "mango",
  "vanilla",
  "fruit",
  "flavored",
  "flavoured",
  "banana",
  "pineapple",
  "lychee",
  "peach",
  "mixed berry",
  "berry",
];

function hasAnyToken(tokens: Iterable<string>, candidates: string[]) {
  const tokenSet = tokens instanceof Set ? tokens : new Set(tokens);
  return candidates.some((candidate) => tokenSet.has(candidate));
}

function includesAnyPhrase(text: string, phrases: string[]) {
  return phrases.some((phrase) => text.includes(phrase));
}

function singularize(word: string) {
  if (word.endsWith("ies") && word.length > 3) {
    return `${word.slice(0, -3)}y`;
  }
  if (word.endsWith("es") && word.length > 3) {
    return word.slice(0, -2);
  }
  if (word.endsWith("s") && word.length > 3) {
    return word.slice(0, -1);
  }
  return word;
}

export function tokenizeIngredientSearch(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => singularize(token.trim()))
    .filter((token) => token.length > 1);
}

export function getIngredientMatchTokens(ingredient: string) {
  const directTokens = tokenizeIngredientSearch(ingredient);
  const expanded = new Set(directTokens);

  for (const token of directTokens) {
    const aliases = INGREDIENT_ALIASES[token] ?? [];
    for (const alias of aliases) {
      expanded.add(alias);
      for (const aliasToken of tokenizeIngredientSearch(alias)) {
        expanded.add(aliasToken);
      }
    }
  }

  return [...expanded];
}

export function getIngredientQueryCandidates(ingredient: string) {
  const primary = ingredient.trim();
  const candidates = new Set([primary]);
  const normalizedPrimary = primary.toLowerCase().trim();
  const exactAliases = EXACT_QUERY_ALIASES[normalizedPrimary] ?? [];
  for (const alias of exactAliases) {
    candidates.add(alias);
  }
  const directTokens = tokenizeIngredientSearch(ingredient);

  for (const token of directTokens) {
    const aliases = INGREDIENT_ALIASES[token] ?? [];
    for (const alias of aliases) {
      candidates.add(alias);
    }
  }

  return [...candidates].filter(Boolean);
}

export function scoreIngredientProductMatch(name: string, ingredient: string) {
  const nameLower = name.toLowerCase();
  const nameTokens = new Set(tokenizeIngredientSearch(name));
  const directTokens = tokenizeIngredientSearch(ingredient);
  const matchTokens = getIngredientMatchTokens(ingredient);

  if (!directTokens.length) {
    return 0;
  }

  let score = 0;
  for (const token of directTokens) {
    if (nameTokens.has(token)) {
      score += 3;
    }
    if (nameLower.includes(token)) {
      score += 1;
    }
  }

  for (const token of matchTokens) {
    if (directTokens.includes(token)) {
      continue;
    }
    if (nameTokens.has(token)) {
      score += 2;
    }
    if (nameLower.includes(token)) {
      score += 1;
    }
  }

  if (directTokens.some((token) => PLAIN_YOGURT_TOKENS.has(token))) {
    if (FLAVORED_YOGURT_TOKENS.some((token) => nameLower.includes(token))) {
      score -= 8;
    }
    if (nameLower.includes("plain")) {
      score += 2;
    }
  }

  const wantsFreshCoriander =
    hasAnyToken(directTokens, ["coriander", "cilantro", "dhania"]) &&
    !hasAnyToken(directTokens, ["powder", "seed"]);
  if (
    wantsFreshCoriander &&
    includesAnyPhrase(nameLower, ["leaves", "leaf", "bunch", "fresh"])
  ) {
    score += 4;
  }
  if (
    wantsFreshCoriander &&
    includesAnyPhrase(nameLower, ["powder", "seed", "seeds", "chutney", "paste"])
  ) {
    score -= 9;
  }

  const wantsFreshMint =
    hasAnyToken(directTokens, ["mint", "pudina"]) &&
    !hasAnyToken(directTokens, ["dried", "powder"]);
  if (
    wantsFreshMint &&
    includesAnyPhrase(nameLower, ["chutney", "syrup", "extract", "powder", "dry", "dried"])
  ) {
    score -= 8;
  }

  const wantsFreshCurryLeaves =
    hasAnyToken(directTokens, ["curry", "leaf"]) || ingredient.toLowerCase().includes("curry leaves");
  if (
    wantsFreshCurryLeaves &&
    includesAnyPhrase(nameLower, ["powder", "masala", "seasoning"])
  ) {
    score -= 8;
  }

  const wantsFreshGreenChili =
    hasAnyToken(directTokens, ["chili", "chilies", "chilli", "mirchi"]) &&
    !hasAnyToken(directTokens, ["powder", "flake", "sauce"]);
  if (
    wantsFreshGreenChili &&
    includesAnyPhrase(nameLower, ["powder", "flakes", "flake", "sauce", "pickle", "paste"])
  ) {
    score -= 8;
  }

  const wantsPlainRice =
    hasAnyToken(directTokens, ["rice"]) &&
    !hasAnyToken(directTokens, ["flour", "noodle", "paper"]);
  if (
    wantsPlainRice &&
    includesAnyPhrase(nameLower, ["flour", "paper", "noodle", "bran"])
  ) {
    score -= 9;
  }

  const wantsCorn =
    hasAnyToken(directTokens, ["corn", "maize"]) &&
    !hasAnyToken(directTokens, ["flour", "starch"]);
  if (
    wantsCorn &&
    includesAnyPhrase(nameLower, ["flour", "starch", "cornflour", "corn flour"])
  ) {
    score -= 8;
  }

  const wantsRegularOnion =
    hasAnyToken(directTokens, ["onion"]) &&
    !includesAnyPhrase(ingredient.toLowerCase(), ["spring onion", "green onion", "scallion"]);
  if (
    wantsRegularOnion &&
    includesAnyPhrase(nameLower, ["spring onion", "green onion", "scallion"])
  ) {
    score -= 7;
  }

  const wantsFreshGarlic =
    hasAnyToken(directTokens, ["garlic"]) &&
    !hasAnyToken(directTokens, ["paste", "powder"]);
  if (
    wantsFreshGarlic &&
    includesAnyPhrase(nameLower, ["paste", "powder", "bread", "pickle"])
  ) {
    score -= 8;
  }

  const wantsFreshGinger =
    hasAnyToken(directTokens, ["ginger"]) &&
    !hasAnyToken(directTokens, ["paste", "powder"]);
  if (
    wantsFreshGinger &&
    includesAnyPhrase(nameLower, ["paste", "powder", "candy", "ale", "garlic"])
  ) {
    score -= 7;
  }

  const wantsFreshCoconut =
    hasAnyToken(directTokens, ["coconut"]) &&
    !hasAnyToken(directTokens, ["milk", "water", "oil"]);
  if (
    wantsFreshCoconut &&
    includesAnyPhrase(nameLower, ["oil", "water", "milk"])
  ) {
    score -= 8;
  }

  const wantsCuminSeeds =
    hasAnyToken(directTokens, ["cumin", "jeera"]) &&
    !hasAnyToken(directTokens, ["powder"]);
  if (wantsCuminSeeds && includesAnyPhrase(nameLower, ["powder"])) {
    score -= 7;
  }

  const wantsRegularTomatoes =
    hasAnyToken(directTokens, ["tomato"]) &&
    !hasAnyToken(directTokens, ["cherry"]);
  if (wantsRegularTomatoes && includesAnyPhrase(nameLower, ["cherry tomato"])) {
    score -= 6;
  }
  if (
    wantsRegularTomatoes &&
    includesAnyPhrase(nameLower, ["tomato"]) &&
    !includesAnyPhrase(nameLower, ["cherry"])
  ) {
    score += 2;
  }

  return score;
}
