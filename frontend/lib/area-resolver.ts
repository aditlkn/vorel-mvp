export type AreaCoordinate = {
  label: string;
  latitude: number;
  longitude: number;
};

type AreaSeed = AreaCoordinate & {
  aliases: string[];
};

const AREA_SEEDS: AreaSeed[] = [
  {
    label: "Koramangala",
    latitude: 12.9352,
    longitude: 77.6245,
    aliases: [
      "koramangala",
      "kora",
      "5th block koramangala",
      "6th block koramangala",
      "7th block koramangala",
      "8th block koramangala",
    ],
  },
  {
    label: "HSR Layout",
    latitude: 12.9116,
    longitude: 77.6474,
    aliases: ["hsr", "hsr layout", "hsr sector 1", "hsr sector 2", "hsr sector 3"],
  },
  {
    label: "Indiranagar",
    latitude: 12.9784,
    longitude: 77.6408,
    aliases: ["indiranagar", "indira nagar", "100 feet road indiranagar"],
  },
  {
    label: "Domlur",
    latitude: 12.9611,
    longitude: 77.6387,
    aliases: ["domlur", "domlur layout"],
  },
  {
    label: "Old Airport Road",
    latitude: 12.958,
    longitude: 77.6483,
    aliases: ["old airport road", "airport road"],
  },
  {
    label: "JP Nagar",
    latitude: 12.9077,
    longitude: 77.5858,
    aliases: ["jp nagar", "j p nagar", "jpnagar"],
  },
  {
    label: "Jayanagar",
    latitude: 12.925,
    longitude: 77.5938,
    aliases: ["jayanagar", "4th block jayanagar"],
  },
  {
    label: "Banashankari",
    latitude: 12.9181,
    longitude: 77.5739,
    aliases: ["banashankari", "bsk", "bsk 2nd stage", "bsk 3rd stage"],
  },
  {
    label: "Basavanagudi",
    latitude: 12.9417,
    longitude: 77.5736,
    aliases: ["basavanagudi", "gandhi bazaar"],
  },
  {
    label: "BTM Layout",
    latitude: 12.9166,
    longitude: 77.6101,
    aliases: ["btm", "btm layout", "btm 1st stage", "btm 2nd stage"],
  },
  {
    label: "Bannerghatta Road",
    latitude: 12.8933,
    longitude: 77.597,
    aliases: ["bannerghatta road", "bg road"],
  },
  {
    label: "Electronic City",
    latitude: 12.8456,
    longitude: 77.6603,
    aliases: [
      "electronic city",
      "electronic city phase 1",
      "electronic city phase 2",
      "ecity",
      "e city",
    ],
  },
  {
    label: "Whitefield",
    latitude: 12.9698,
    longitude: 77.75,
    aliases: ["whitefield", "itpl", "hope farm", "hoodi"],
  },
  {
    label: "Marathahalli",
    latitude: 12.9591,
    longitude: 77.6974,
    aliases: ["marathahalli", "marathalli"],
  },
  {
    label: "Bellandur",
    latitude: 12.9255,
    longitude: 77.6765,
    aliases: ["bellandur"],
  },
  {
    label: "Sarjapur Road",
    latitude: 12.9172,
    longitude: 77.6835,
    aliases: ["sarjapur road", "sarjapur"],
  },
  {
    label: "Kadubeesanahalli",
    latitude: 12.9341,
    longitude: 77.6846,
    aliases: ["kadubeesanahalli", "kadubeesanahalli orr"],
  },
  {
    label: "Mahadevapura",
    latitude: 12.9916,
    longitude: 77.6992,
    aliases: ["mahadevapura", "mahadevapura orr"],
  },
  {
    label: "Brookefield",
    latitude: 12.9667,
    longitude: 77.7172,
    aliases: ["brookefield", "brookfield"],
  },
  {
    label: "KR Puram",
    latitude: 13.008,
    longitude: 77.6955,
    aliases: ["kr puram", "k r puram"],
  },
  {
    label: "Yelahanka",
    latitude: 13.1007,
    longitude: 77.5963,
    aliases: ["yelahanka", "new town yelahanka"],
  },
  {
    label: "Hebbal",
    latitude: 13.0358,
    longitude: 77.597,
    aliases: ["hebbal", "hebbal flyover"],
  },
  {
    label: "Sahakara Nagar",
    latitude: 13.0568,
    longitude: 77.5892,
    aliases: ["sahakara nagar", "sahakaranagar"],
  },
  {
    label: "Malleshwaram",
    latitude: 13.0035,
    longitude: 77.5706,
    aliases: ["malleshwaram", "malleswaram"],
  },
  {
    label: "Rajajinagar",
    latitude: 12.9915,
    longitude: 77.5535,
    aliases: ["rajajinagar", "rajaji nagar"],
  },
  {
    label: "Vijayanagar",
    latitude: 12.9719,
    longitude: 77.5369,
    aliases: ["vijayanagar", "vijaya nagar"],
  },
  {
    label: "Yeshwanthpur",
    latitude: 13.028,
    longitude: 77.554,
    aliases: ["yeshwanthpur", "yeshwantpur"],
  },
  {
    label: "MG Road",
    latitude: 12.9756,
    longitude: 77.6066,
    aliases: ["mg road", "m g road"],
  },
  {
    label: "Church Street",
    latitude: 12.9753,
    longitude: 77.6072,
    aliases: ["church street"],
  },
  {
    label: "Brigade Road",
    latitude: 12.9717,
    longitude: 77.6065,
    aliases: ["brigade road"],
  },
  {
    label: "Residency Road",
    latitude: 12.9695,
    longitude: 77.6093,
    aliases: ["residency road"],
  },
  {
    label: "Lavelle Road",
    latitude: 12.9712,
    longitude: 77.5995,
    aliases: ["lavelle road"],
  },
  {
    label: "UB City",
    latitude: 12.9716,
    longitude: 77.5963,
    aliases: ["ub city", "u b city"],
  },
  {
    label: "Richmond Road",
    latitude: 12.9627,
    longitude: 77.6026,
    aliases: ["richmond road"],
  },
  {
    label: "St. Marks Road",
    latitude: 12.9714,
    longitude: 77.6016,
    aliases: ["st marks road", "saint marks road"],
  },
  {
    label: "Cunningham Road",
    latitude: 12.9892,
    longitude: 77.5948,
    aliases: ["cunningham road"],
  },
  {
    label: "Ulsoor",
    latitude: 12.9814,
    longitude: 77.6247,
    aliases: ["ulsoor", "halasuru"],
  },
  {
    label: "Frazer Town",
    latitude: 12.9987,
    longitude: 77.6143,
    aliases: ["frazer town", "pulikeshi nagar"],
  },
  {
    label: "Kalyan Nagar",
    latitude: 13.0244,
    longitude: 77.6408,
    aliases: ["kalyan nagar", "hrbr layout"],
  },
  {
    label: "Kammanahalli",
    latitude: 13.0167,
    longitude: 77.6372,
    aliases: ["kammanahalli", "kammanhalli"],
  },
  {
    label: "Hennur",
    latitude: 13.0418,
    longitude: 77.6512,
    aliases: ["hennur", "hennur road"],
  },
  {
    label: "Bandra",
    latitude: 19.0596,
    longitude: 72.8295,
    aliases: ["bandra"],
  },
  {
    label: "Lower Parel",
    latitude: 18.9987,
    longitude: 72.8306,
    aliases: ["lower parel"],
  },
  {
    label: "Connaught Place",
    latitude: 28.6315,
    longitude: 77.2167,
    aliases: ["connaught place", "cp"],
  },
];

function normalizeAreaHint(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

export function resolveAreaHintsToCoordinates(hints: string[]) {
  const resolved = new Map<string, AreaCoordinate>();

  for (const rawHint of hints) {
    const hint = normalizeAreaHint(rawHint);
    if (!hint) continue;

    const match = AREA_SEEDS.find((area) =>
      area.aliases.some((alias) => {
        const normalizedAlias = normalizeAreaHint(alias);
        return (
          hint === normalizedAlias ||
          hint.includes(normalizedAlias) ||
          normalizedAlias.includes(hint)
        );
      }),
    );

    if (!match) continue;
    resolved.set(match.label, {
      label: match.label,
      latitude: match.latitude,
      longitude: match.longitude,
    });
  }

  return [...resolved.values()];
}
