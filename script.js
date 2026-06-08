// Hard sci-fi star system generator v2.
// New: binary star systems, regenerate/toggle existing planets, moons, and belts.

let lastSystem = null;
let lastCriteria = null;

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rngFromSeed(seed) {
  let state = seed >>> 0;
  return function () {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function systemRng(suffix = "") {
  const seedText = (lastSystem?.seed || "system") + ":" + suffix + ":" + Date.now();
  return rngFromSeed(hashSeed(seedText));
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function between(rng, min, max, decimals = 2) {
  const value = min + rng() * (max - min);
  return Number(value.toFixed(decimals));
}

function chance(rng, p) {
  return rng() < p;
}

function weightedRandomPlanetCount(rng) {
  // Triangular-ish distribution: favours lower values while still allowing 1–10.
  const roll = Math.pow(rng(), 1.9);
  return clamp(Math.ceil(roll * 10), 1, 10);
}

const STAR_TYPES = {
  red_dwarf: {
    label: "Red dwarf / M-type",
    mass: [0.12, 0.55],
    temp: [2400, 3900],
    radius: [0.15, 0.55],
    activity: ["quiet", "moderate flare activity", "high flare activity"],
    lifeStability: "Long-lived, but tidal locking and flares matter."
  },
  orange_dwarf: {
    label: "Orange dwarf / K-type",
    mass: [0.6, 0.85],
    temp: [3900, 5200],
    radius: [0.65, 0.9],
    activity: ["quiet", "mild activity", "moderate activity"],
    lifeStability: "Very favourable for long-term stable biospheres."
  },
  yellow_dwarf: {
    label: "Yellow dwarf / G-type",
    mass: [0.86, 1.15],
    temp: [5200, 6100],
    radius: [0.9, 1.2],
    activity: ["quiet", "solar-like activity", "moderate activity"],
    lifeStability: "Favourable, with finite main-sequence lifetime."
  },
  f_type: {
    label: "F-type star",
    mass: [1.16, 1.6],
    temp: [6100, 7500],
    radius: [1.2, 1.7],
    activity: ["strong UV output", "bright stable output", "moderate activity"],
    lifeStability: "Broad habitable zone, but shorter lifetime and higher UV stress reduce complex-life odds."
  },
  a_type: {
    label: "A-type star",
    mass: [1.61, 2.4],
    temp: [7500, 10000],
    radius: [1.7, 2.7],
    activity: ["intense blue-white radiation", "high UV output", "rapid rotation"],
    lifeStability: "Large bright system, but main-sequence lifetime is usually too short for complex biospheres."
  },
  giant_star: {
    label: "Giant star",
    mass: [0.9, 3.0],
    temp: [3200, 5200],
    radius: [10, 80],
    activity: ["unstable expanded envelope", "strong stellar wind", "variable luminosity"],
    lifeStability: "Late-stage star. Inner worlds are likely sterilised or engulfed; any habitability is temporary and far out."
  },
  supergiant_star: {
    label: "Supergiant star",
    mass: [8, 40],
    temp: [3500, 20000],
    radius: [80, 900],
    activity: ["violent mass loss", "extreme luminosity", "unstable radiation output"],
    lifeStability: "Very short-lived and hostile. Natural long-term habitability is effectively impossible."
  },
  white_dwarf: {
    label: "White dwarf remnant",
    mass: [0.5, 0.9],
    temp: [5000, 11000],
    radius: [0.009, 0.018],
    activity: ["low visible output", "compact remnant radiation"],
    lifeStability: "Possible but difficult; habitable zone is close and changes over time."
  },
  neutron_star: {
    label: "Neutron star / pulsar",
    mass: [1.1, 2.2],
    temp: [300000, 900000],
    radius: [0.000015, 0.000025],
    activity: ["pulsar beams", "hard radiation", "magnetar-like activity"],
    lifeStability: "Extreme radiation and formation history make ordinary habitable planets extremely unlikely."
  },
  stellar_black_hole: {
    label: "Stellar black hole",
    mass: [3, 30],
    temp: [0, 0],
    radius: [0.00003, 0.0003],
    activity: ["dark unless accreting", "possible accretion radiation", "tidal hazards"],
    lifeStability: "No useful stellar light. Worlds need exotic heating, captured status, or a luminous companion."
  },
  intermediate_black_hole: {
    label: "Intermediate black hole",
    mass: [100, 10000],
    temp: [0, 0],
    radius: [0.001, 0.1],
    activity: ["dark unless accreting", "cluster-centre dynamics", "tidal disruption risk"],
    lifeStability: "Stable orbits are possible, but normal star-like habitability is not."
  },
  supermassive_black_hole: {
    label: "Supermassive black hole",
    mass: [100000, 10000000],
    temp: [0, 0],
    radius: [1, 80],
    activity: ["galactic nucleus environment", "active accretion risk", "extreme orbital velocities"],
    lifeStability: "Exotic galactic-core setting. Habitability requires special shielding and non-standard energy sources."
  }
};

function luminosityFromMass(starType, mass, radius, temp) {
  if (starType.includes("black_hole")) return 0.000001;
  if (starType === "neutron_star") return 0.00001;
  if (starType === "white_dwarf") {
    return Math.max(0.0001, Math.pow(radius, 2) * Math.pow(temp / 5778, 4));
  }
  if (starType === "giant_star" || starType === "supergiant_star") {
    return Math.max(1, Math.pow(radius, 2) * Math.pow(temp / 5778, 4));
  }
  if (starType === "a_type" || starType === "f_type") return Math.pow(mass, 3.8);
  return Math.pow(mass, 3.5);
}

function makeStar(rng, selectedType, role = "primary") {
  let type = selectedType === "random"
    ? pick(rng, [
        "red_dwarf", "red_dwarf", "red_dwarf",
        "orange_dwarf", "orange_dwarf", "orange_dwarf",
        "yellow_dwarf", "yellow_dwarf",
        "f_type",
        "a_type",
        "white_dwarf",
        "giant_star",
        "stellar_black_hole"
      ])
    : selectedType;

  const model = STAR_TYPES[type];
  const mass = between(rng, model.mass[0], model.mass[1], 3);
  const radius = between(rng, model.radius[0], model.radius[1], 3);
  const temp = Math.round(between(rng, model.temp[0], model.temp[1], 0));
  const luminosity = Number(luminosityFromMass(type, mass, radius, temp).toFixed(4));

  return {
    role,
    type,
    label: model.label,
    massSolar: mass,
    radiusSolar: radius,
    tempK: temp,
    luminositySolar: luminosity,
    activity: pick(rng, model.activity),
    lifeStability: model.lifeStability
  };
}

function buildStellarSystem(rng, criteria) {
  let architecture = criteria.architecture;
  if (architecture === "random") architecture = pick(rng, ["single", "single", "binary_circumbinary", "binary_s_type"]);

  const primary = makeStar(rng, criteria.starType, "primary");

  if (architecture === "single") {
    return {
      architecture,
      stars: [primary],
      totalMassSolar: primary.massSolar,
      totalLuminositySolar: primary.luminositySolar,
      binary: null
    };
  }

  const secondary = makeStar(rng, criteria.secondaryStarType, "secondary");
  if (secondary.massSolar > primary.massSolar) {
    const p = { ...secondary, role: "primary" };
    const s = { ...primary, role: "secondary" };
    return finishBinary(rng, architecture, [p, s]);
  }
  return finishBinary(rng, architecture, [primary, secondary]);
}

function finishBinary(rng, architecture, stars) {
  const totalMass = Number((stars[0].massSolar + stars[1].massSolar).toFixed(3));
  const totalLum = Number((stars[0].luminositySolar + stars[1].luminositySolar).toFixed(4));

  let separationAU, eccentricity, stableInnerAU, stableOuterAU, stabilityNote;

  if (architecture === "binary_circumbinary") {
    separationAU = between(rng, 0.04, 0.45, 3);
    eccentricity = between(rng, 0.0, 0.35, 2);
    stableInnerAU = Number((separationAU * (3.0 + eccentricity * 3.0)).toFixed(3));
    stableOuterAU = null;
    stabilityNote = `Planets orbit both stars. Stable circumbinary orbits start beyond roughly ${stableInnerAU} AU.`;
  } else {
    separationAU = between(rng, 8, 90, 2);
    eccentricity = between(rng, 0.0, 0.55, 2);
    stableInnerAU = 0.02;
    stableOuterAU = Number((separationAU * (0.18 - eccentricity * 0.07)).toFixed(3));
    stabilityNote = `Planets orbit the primary star. Stable planetary orbits should remain inside roughly ${stableOuterAU} AU.`;
  }

  return {
    architecture,
    stars,
    totalMassSolar: totalMass,
    totalLuminositySolar: totalLum,
    binary: {
      separationAU,
      eccentricity,
      stableInnerAU,
      stableOuterAU,
      stabilityNote
    }
  };
}

function effectiveLuminosity(system) {
  if (system.architecture === "binary_s_type") return system.stars[0].luminositySolar;
  return system.totalLuminositySolar;
}

function effectiveMass(system) {
  if (system.architecture === "binary_s_type") return system.stars[0].massSolar;
  return system.totalMassSolar;
}

function habitableZone(luminosity) {
  return {
    inner: Number(Math.sqrt(luminosity / 1.1).toFixed(3)),
    outer: Number(Math.sqrt(luminosity / 0.53).toFixed(3))
  };
}

function frostLine(luminosity) {
  return Number((4.85 * Math.sqrt(luminosity)).toFixed(3));
}

function systemAge(rng, selected) {
  if (selected !== "random") return selected;
  return pick(rng, ["young", "mature", "mature", "ancient"]);
}

function ageGyr(rng, age) {
  if (age === "young") return between(rng, 0.2, 1.8, 1);
  if (age === "mature") return between(rng, 2.0, 7.0, 1);
  return between(rng, 7.1, 11.5, 1);
}

function orbitalPeriodYears(distanceAU, massSolar) {
  return Number(Math.sqrt(Math.pow(distanceAU, 3) / massSolar).toFixed(2));
}

function planetTypeForOrbit(rng, distance, frost, metallicity, forceGas) {
  if (forceGas) return "gas giant";
  const beyondFrost = distance > frost;
  const highMetal = metallicity === "high";
  const gasChance = beyondFrost ? (highMetal ? 0.42 : 0.28) : 0.04;
  if (chance(rng, gasChance)) return pick(rng, ["gas giant", "ice giant"]);
  if (beyondFrost) return pick(rng, ["ice world", "dwarf planet", "super-Earth", "icy terrestrial"]);
  return pick(rng, ["terrestrial", "super-Earth", "carbon-rich terrestrial", "ocean world"]);
}

function estimateTemp(luminosity, distance, greenhouseK) {
  const equilibrium = 278 * Math.pow(luminosity, 0.25) / Math.sqrt(distance);
  return Math.round(equilibrium + greenhouseK);
}

function atmosphereForPlanet(rng, type, tempK) {
  if (["gas giant", "ice giant"].includes(type)) return "H₂/He-dominated deep atmosphere";
  if (type.includes("dwarf")) return chance(rng, 0.25) ? "thin N₂/CH₄ transient atmosphere" : "negligible";
  if (tempK > 650) return pick(rng, ["dense CO₂/N₂", "steam-rich runaway greenhouse", "thin mineral vapour traces"]);
  if (tempK < 180) return pick(rng, ["thin N₂/CO₂", "frozen volatiles with trace gas", "negligible"]);
  return pick(rng, ["N₂/CO₂/H₂O", "N₂/O₂/Ar", "dense CO₂/N₂", "thin CO₂/N₂"]);
}


function resolveRichElement(rng, selected) {
  if (!selected || selected === "none") return "none";
  if (selected !== "random") return selected;
  return pick(rng, ["iron", "carbon", "silicon", "oxygen", "water", "nitrogen", "sulfur", "uranium", "gold", "helium3"]);
}

function richElementLabel(value) {
  const labels = {
    none: "none",
    iron: "iron-rich",
    carbon: "carbon-rich",
    silicon: "silicate-rich",
    oxygen: "oxygen/oxide-rich",
    water: "water/volatile-rich",
    nitrogen: "nitrogen-rich",
    sulfur: "sulfur-rich",
    uranium: "uranium/thorium-rich",
    gold: "gold/noble-metal-rich",
    helium3: "helium-3-rich"
  };
  return labels[value] || value;
}

function enrichPlanetType(rng, type, richElement) {
  if (richElement === "carbon" && ["terrestrial", "super-Earth"].includes(type) && chance(rng, 0.55)) return "carbon-rich terrestrial";
  if (richElement === "water" && ["terrestrial", "super-Earth", "icy terrestrial"].includes(type) && chance(rng, 0.55)) return "ocean world";
  if (richElement === "iron" && ["terrestrial", "super-Earth"].includes(type) && chance(rng, 0.45)) return "iron-rich terrestrial";
  if (richElement === "helium3" && chance(rng, 0.2)) return pick(rng, ["gas giant", "ice giant"]);
  return type;
}

function enrichComposition(base, richElement, type) {
  const additions = {
    iron: "iron-enriched mantle/core; dense metal deposits",
    carbon: "carbonaceous crust chemistry; graphite/carbide deposits",
    silicon: "silicate-rich crust and mantle; abundant mineral diversity",
    oxygen: "oxide-rich minerals; oxidised crust chemistry",
    water: "hydrated minerals, water ice and volatile inventory",
    nitrogen: "nitrogen/ammonia volatile enrichment",
    sulfur: "sulphide minerals and volcanic sulphur chemistry",
    uranium: "radiogenic-element enrichment; elevated internal heating",
    gold: "trace noble-metal enrichment; valuable heavy-element deposits",
    helium3: "helium-3/fusion-fuel enrichment in giant atmospheres or exposed regolith"
  };
  if (!richElement || richElement === "none") return base;
  return `${base}; ${additions[richElement] || richElement + " enrichment"}`;
}

function compositionForType(type) {
  const map = {
    "gas giant": "hydrogen/helium envelope over dense core",
    "ice giant": "water/ammonia/methane ices with H₂/He envelope",
    "ice world": "silicate core, water ice mantle, frozen volatiles",
    "dwarf planet": "ice-rock mixture",
    "icy terrestrial": "rocky body with thick ice inventory",
    "terrestrial": "silicate mantle, iron-nickel core",
    "iron-rich terrestrial": "oversized iron-nickel core, thin silicate mantle",
    "super-Earth": "rock-metal body, high-pressure mantle",
    "carbon-rich terrestrial": "carbon-rich crust and carbide minerals",
    "ocean world": "global ocean over silicate or high-pressure ice layers"
  };
  return map[type] || "mixed rock/ice";
}

function moonStats(rng, parent, count) {
  const moons = [];
  for (let i = 1; i <= count; i++) {
    const size = pick(rng, ["minor captured body", "small moon", "medium moon", "large moon"]);
    const tidalHeating = parent.type.includes("giant") && chance(rng, 0.28);
    const subsurface = tidalHeating || chance(rng, 0.08);
    moons.push({
      hidden: false,
      name: `${parent.name}-${String.fromCharCode(96 + i)}`,
      sizeClass: size,
      orbitalPeriodDays: between(rng, 0.6, 90, 1),
      composition: pick(rng, ["rocky", "ice-rich", "mixed rock/ice", "carbonaceous"]),
      tidalHeating,
      atmosphere: size === "large moon" && chance(rng, 0.25) ? "thin retained atmosphere" : "none or trace exosphere",
      subsurfaceOcean: subsurface,
      lifePotential: subsurface ? "possible microbial subsurface ecology" : "unlikely"
    });
  }
  return moons;
}


function lifeComplexityRank(value) {
  const ranks = {
    "None": 0,
    "Prebiotic chemistry": 1,
    "Microbial life": 2,
    "Microbial subsurface life sustained by geological activity": 2,
    "Simple multicellular life": 3,
    "Complex multicellular life": 4,
    "Complex animal-like life": 5,
    "Technological civilisation candidate": 6
  };
  return ranks[value] ?? 0;
}

function requiredLifeRank(criteria) {
  const ranks = {
    any: 0,
    prebiotic: 1,
    single_celled: 2,
    multicellular_simple: 3,
    complex_life: 4,
    animal_life: 5,
    technological_life: 6
  };
  return ranks[criteria.lifeComplexity || "any"] ?? 0;
}

function lifeLabelForRank(rank) {
  if (rank >= 6) return "Technological civilisation candidate";
  if (rank >= 5) return "Complex animal-like life";
  if (rank >= 4) return "Complex multicellular life";
  if (rank >= 3) return "Simple multicellular life";
  if (rank >= 2) return "Microbial life";
  if (rank >= 1) return "Prebiotic chemistry";
  return "None";
}

function lifeComplexityLabel(value) {
  const labels = {
    any: "any / no minimum",
    prebiotic: "prebiotic chemistry",
    single_celled: "single-celled microbial life",
    multicellular_simple: "simple multicellular life",
    complex_life: "complex multicellular life",
    animal_life: "complex animal-like life",
    technological_life: "technological civilisation candidate"
  };
  return labels[value] || "any / no minimum";
}


function geologySupportedLifePossible(planet) {
  const coldEnoughForSubsurface = planet.avgTempK < 250;
  const hasInternalEnergy = planet.tectonicallyActive || planet.type.includes("ice") || planet.type.includes("ocean");
  const hasVolatiles = String(planet.composition || "").toLowerCase().includes("ice") ||
    String(planet.composition || "").toLowerCase().includes("water") ||
    String(planet.composition || "").toLowerCase().includes("volatile") ||
    planet.type.includes("ocean") ||
    planet.type.includes("ice");
  return hasInternalEnergy && hasVolatiles && coldEnoughForSubsurface;
}

function lifeRequiresHabitableZone(lifeLabel) {
  return [
    "Simple multicellular life",
    "Complex multicellular life",
    "Complex animal-like life",
    "Technological civilisation candidate"
  ].includes(lifeLabel);
}

function offZoneGeologyLifeLabel(planet) {
  if (geologySupportedLifePossible(planet)) return "Microbial subsurface life sustained by geological activity";
  return "None";
}

function assessLife(rng, planet, system, criteria) {
  const hz = system.habitableZoneAU;
  const inHZ = planet.orbitAU >= hz.inner && planet.orbitAU <= hz.outer;
  const rocky = ["terrestrial", "super-Earth", "ocean world", "icy terrestrial", "carbon-rich terrestrial"].includes(planet.type);
  const tempOK = planet.avgTempK >= 250 && planet.avgTempK <= 330;
  const atmosphereOK = !["negligible", "thin mineral vapour traces"].includes(planet.atmosphere);
  const oldEnough = criteria.ageGyr >= 1.5;

  const mainStar = system.stars[0];
  const flarePenalty = mainStar.type === "red_dwarf" && mainStar.activity === "high flare activity";
  const binaryPenalty = system.binary && system.architecture === "binary_circumbinary" ? 7 : 0;
  const tidallyLockedPenalty = planet.tidallyLocked && !criteria.allowTidallyLockedLife;

  let score = 0;
  if (inHZ) score += 30;
  if (rocky) score += 20;
  if (tempOK) score += 20;
  if (atmosphereOK) score += 15;
  if (planet.magneticField) score += 8;
  if (planet.tectonicallyActive) score += 7;
  if (oldEnough) score += 8;
  if (flarePenalty) score -= 18;
  if (binaryPenalty) score -= binaryPenalty;
  if (tidallyLockedPenalty) score -= 30;
  score = Math.max(0, Math.min(100, score));

  let life = "None";
  if (score >= 88) {
    life = chance(rng, 0.08) ? "Technological civilisation candidate" : "Complex animal-like life";
  } else if (score >= 78) {
    life = chance(rng, 0.45) ? "Complex animal-like life" : "Complex multicellular life";
  } else if (score >= 70) {
    const complexChance = criteria.lifeBias === "optimistic" || criteria.lifeBias === "forced" ? 0.42 : 0.18;
    life = chance(rng, complexChance) ? "Complex multicellular life" : "Simple multicellular life";
  } else if (score >= 60) {
    life = chance(rng, 0.45) ? "Simple multicellular life" : "Microbial life";
  } else if (score >= 52) {
    life = chance(rng, 0.55) ? "Microbial life" : "Prebiotic chemistry";
  } else if (score >= 40) {
    life = "Prebiotic chemistry";
  }

  const requiredRank = requiredLifeRank(criteria);
  if ((criteria.requireLife || criteria.lifeBias === "forced") && requiredRank > 0 && lifeComplexityRank(life) < requiredRank) {
    if (score >= 40 || criteria.lifeBias === "forced") {
      life = lifeLabelForRank(requiredRank);
      score = Math.max(score, [0, 42, 58, 68, 78, 84, 90][requiredRank] || score);
    }
  }

  const finalInHZ = planet.orbitAU >= hz.inner && planet.orbitAU <= hz.outer;
  if (!finalInHZ && life !== "None" && life !== "Prebiotic chemistry") {
    if (geologySupportedLifePossible(planet)) {
      life = offZoneGeologyLifeLabel(planet);
      score = Math.min(score, 62);
    } else {
      life = score >= 40 ? "Prebiotic chemistry" : "None";
      score = Math.min(score, 45);
    }
  }

  if (!finalInHZ && lifeRequiresHabitableZone(life)) {
    life = geologySupportedLifePossible(planet) ? offZoneGeologyLifeLabel(planet) : "None";
    score = Math.min(score, 45);
  }

  return { score, life };
}

function generatePlanet(rng, index, system, criteria, distance, forceGas = false, preserveName = null) {
  const type = enrichPlanetType(rng, planetTypeForOrbit(rng, distance, system.frostLineAU, criteria.metallicity, forceGas), criteria.richElement);
  const greenhouse = ["gas giant", "ice giant"].includes(type) ? 0 : between(rng, 0, 55, 0);
  const avgTempK = estimateTemp(system.effectiveLuminositySolar, distance, greenhouse);
  const year = orbitalPeriodYears(distance, system.effectiveMassSolar);
  const mainStar = system.stars[0];
  const tidallyLocked = mainStar.type === "red_dwarf" && distance < system.habitableZoneAU.outer * 1.25 && chance(rng, 0.65);
  const rotationHours = tidallyLocked ? Math.round(year * 365.25 * 24) : between(rng, 8, 80, 1);
  const radiusEarth = ["gas giant", "ice giant"].includes(type) ? between(rng, 3.6, 11.5, 1) : between(rng, 0.35, 2.1, 2);
  const massEarth = ["gas giant", "ice giant"].includes(type) ? between(rng, 15, 420, 1) : between(rng, 0.05, 8.5, 2);
  const gravity = Number((massEarth / (radiusEarth * radiusEarth)).toFixed(2));
  const tectonicsBase = criteria.richElement === "uranium" ? 0.62 : 0.45;
  const tectonics = !["gas giant", "ice giant", "dwarf planet"].includes(type) && chance(rng, tectonicsBase);
  const magneticBase = criteria.richElement === "iron" ? 0.75 : (tectonics ? 0.55 : 0.25);
  const magnetic = ["gas giant", "ice giant"].includes(type) || chance(rng, magneticBase);
  const rings = ["gas giant", "ice giant"].includes(type) ? chance(rng, 0.55) : chance(rng, 0.04);
  const moonCount = ["gas giant", "ice giant"].includes(type) ? Math.floor(between(rng, 4, 26, 0)) : Math.floor(between(rng, 0, 4, 0));

  const planet = {
    hidden: false,
    name: preserveName || `${mainStar.label.split(" ")[0].toUpperCase()}-${index}`,
    type,
    orbitAU: Number(distance.toFixed(3)),
    eccentricity: between(rng, 0.0, 0.22, 2),
    yearEarthYears: year,
    tidallyLocked,
    dayNightCycle: tidallyLocked ? "Permanent day/night hemispheres" : `${rotationHours} hours`,
    avgTempK,
    avgTempC: Math.round(avgTempK - 273.15),
    radiusEarth,
    massEarth,
    surfaceGravityG: gravity,
    atmosphere: atmosphereForPlanet(rng, type, avgTempK),
    composition: enrichComposition(compositionForType(type), criteria.richElement, type),
    tectonicallyActive: tectonics,
    magneticField: magnetic,
    rings,
    moons: []
  };

  const life = assessLife(rng, planet, system, criteria);
  planet.habitabilityScore = life.score;
  planet.supportsLife = life.life;
  planet.moons = moonStats(rng, planet, moonCount);
  return planet;
}

function forceLifeWorld(rng, planets, system, criteria) {
  if (planets.some(p => !["None", "Prebiotic chemistry"].includes(p.supportsLife))) return;

  const orbit = between(rng, system.habitableZoneAU.inner * 1.05, system.habitableZoneAU.outer * 0.95, 3);
  const p = generatePlanet(rng, planets.length + 1, system, criteria, orbit, false, "LIFE-CANDIDATE");
  p.type = pick(rng, ["terrestrial", "super-Earth", "ocean world"]);
  p.avgTempK = between(rng, 275, 305, 0);
  p.avgTempC = Math.round(p.avgTempK - 273.15);
  p.atmosphere = pick(rng, ["N₂/CO₂/H₂O", "N₂/O₂/Ar"]);
  p.tectonicallyActive = true;
  p.magneticField = true;
  const requiredRank = requiredLifeRank(criteria);
  const minimumScore = [72, 72, 74, 78, 84, 88, 92][requiredRank] || 72;
  p.habitabilityScore = between(rng, minimumScore, 96, 0);
  const forcedLife = requiredRank > 0
    ? lifeLabelForRank(requiredRank)
    : pick(rng, ["Microbial life", "Microbial life", "Simple multicellular life", "Complex multicellular life"]);
  const inHZ = p.orbitAU >= system.habitableZoneAU.inner && p.orbitAU <= system.habitableZoneAU.outer;
  p.supportsLife = inHZ
    ? forcedLife
    : (geologySupportedLifePossible(p) ? "Microbial subsurface life sustained by geological activity" : "Prebiotic chemistry");
  planets.push(p);
}


function forceColonisationWorld(rng, planets, system, criteria) {
  if (planets.some(p => !p.hidden && isSuitableForColonisation(p, system))) return;

  const orbit = between(rng, system.habitableZoneAU.inner * 1.08, system.habitableZoneAU.outer * 0.92, 3);
  const p = generatePlanet(rng, planets.length + 1, system, criteria, orbit, false, "COLONY-CANDIDATE");
  p.type = pick(rng, ["terrestrial", "super-Earth", "ocean world"]);
  p.avgTempK = between(rng, 275, 305, 0);
  p.avgTempC = Math.round(p.avgTempK - 273.15);
  p.atmosphere = pick(rng, ["N₂/CO₂/H₂O", "N₂/O₂/Ar"]);
  p.tectonicallyActive = true;
  p.magneticField = true;
  p.orbitalStability = "stable generated orbit";
  p.composition = enrichComposition(compositionForType(p.type), criteria.richElement, p.type);
  planets.push(p);
}

function forceOutpostWorld(rng, planets, system, criteria) {
  if (planets.some(p => !p.hidden && isSuitableForOutpost(p, system))) return;

  const outer = Math.max(system.frostLineAU * 1.4, system.habitableZoneAU.outer * 1.6, 1);
  const orbit = between(rng, system.habitableZoneAU.outer * 1.15, outer + 2, 3);
  const p = generatePlanet(rng, planets.length + 1, system, criteria, orbit, false, "OUTPOST-CANDIDATE");
  p.type = pick(rng, ["terrestrial", "super-Earth", "icy terrestrial", "carbon-rich terrestrial", "iron-rich terrestrial"]);
  p.atmosphere = p.atmosphere === "negligible" ? "thin CO₂/N₂" : p.atmosphere;
  p.orbitalStability = p.orbitalStability || "stable generated orbit";

  const forcedResource = criteria.richElement && criteria.richElement !== "none"
    ? criteria.richElement
    : pick(rng, ["iron", "uranium", "gold", "water"]);
  p.composition = enrichComposition(compositionForType(p.type), forcedResource, p.type);
  planets.push(p);
}

function stationEconomicReasonsForPlanet(planet, system) {
  const reasons = [];

  if (isSuitableForColonisation(planet, system)) reasons.push("colonisation support");
  if (isSuitableForOutpost(planet, system)) reasons.push("resource extraction outpost");
  if (isStrongBiosphere(planet)) reasons.push("biosphere research and protection");
  if (planet.rings && planet.type.includes("giant")) reasons.push("ring mining and fuel logistics");

  const composition = String(planet.composition || "").toLowerCase();
  if (composition.includes("helium-3")) reasons.push("helium-3 fuel harvesting");
  if (composition.includes("radiogenic") || composition.includes("uranium") || composition.includes("thorium")) reasons.push("radiogenic heavy-element extraction");
  if (composition.includes("noble") || composition.includes("gold")) reasons.push("noble-metal extraction");
  if (composition.includes("metal") || composition.includes("iron")) reasons.push("metal refining");
  if (composition.includes("volatile") || composition.includes("ice") || composition.includes("water")) reasons.push("volatile harvesting");

  return [...new Set(reasons)];
}

function stationEconomicReasonsForBelt(belt, system) {
  const reasons = [];
  const c = String(belt.composition || "").toLowerCase();

  if (c.includes("metal") || c.includes("iron")) reasons.push("asteroid mining and metal refining");
  if (c.includes("carbon")) reasons.push("carbonaceous materials and organics");
  if (c.includes("volatile") || c.includes("ice") || c.includes("water")) reasons.push("water, propellant and volatile harvesting");
  if (c.includes("uranium") || c.includes("thorium") || c.includes("radiogenic")) reasons.push("radiogenic heavy-element extraction");
  if (c.includes("gold") || c.includes("noble")) reasons.push("noble-metal extraction");
  if (system.richElement && system.richElement !== "none") reasons.push(`${richElementLabel(system.richElement)} exploitation`);

  return [...new Set(reasons)];
}

function stationEconomicReasonsForStargate(system) {
  return ["stargate traffic control", "customs", "ship servicing", "cargo transfer", "courier-data exchange"];
}

function stationTypeForReasons(rng, reasons, anchorType) {
  const joined = reasons.join(" ").toLowerCase();

  if (anchorType === "stargate") return pick(rng, ["Gate traffic station", "Courier-data exchange hub", "Transit habitat"]);
  if (joined.includes("colonisation")) return pick(rng, ["Orbital colony hub", "Highport habitat", "Civilian transfer station"]);
  if (joined.includes("biosphere")) return pick(rng, ["Biosecurity research station", "Protected-world observation habitat", "Exobiology platform"]);
  if (joined.includes("helium") || joined.includes("fuel")) return pick(rng, ["Fuel-harvesting refinery", "Gas-giant skimming platform", "Propellant depot"]);
  if (joined.includes("mining") || joined.includes("metal") || joined.includes("extraction") || joined.includes("refining")) return pick(rng, ["Industrial mining station", "Ore refinery habitat", "Resource-processing platform"]);
  if (joined.includes("volatile") || joined.includes("water") || joined.includes("propellant")) return pick(rng, ["Volatile-harvesting station", "Ice refinery habitat", "Propellant depot"]);

  return pick(rng, ["Commercial orbital habitat", "Logistics station", "Industrial freeport"]);
}

function createStation(rng, anchor, system, index) {
  const anchorType = anchor.anchorType;
  const reasons = anchorType === "planet"
    ? stationEconomicReasonsForPlanet(anchor.body, system)
    : anchorType === "belt"
      ? stationEconomicReasonsForBelt(anchor.body, system)
      : stationEconomicReasonsForStargate(system);

  if (!reasons.length) return null;

  const orbitOffset = anchorType === "planet"
    ? between(rng, -0.004, 0.004, 5)
    : anchorType === "belt"
      ? between(rng, -0.03, 0.03, 4)
      : 0;

  return {
    hidden: false,
    name: `${anchorType === "stargate" ? "GATE" : anchor.body.name ? anchor.body.name : anchor.body.type.toUpperCase()}-${index}-STATION`,
    type: stationTypeForReasons(rng, reasons, anchorType),
    anchorType,
    anchorName: anchorType === "stargate" ? "Stargate" : (anchor.body.name || anchor.body.type),
    orbitAU: Number((anchor.orbitAU + orbitOffset).toFixed(5)),
    reasons,
    populationClass: pick(rng, ["small crewed station", "medium habitat", "large orbital habitat", "industrial platform"]),
    profitability: pick(rng, ["marginal but justified", "profitable", "high-value", "strategically essential"])
  };
}

function generateStations(rng, system, criteria) {
  if (criteria.allowStations === false) return [];

  const anchors = [];

  system.planets.forEach(p => {
    const reasons = stationEconomicReasonsForPlanet(p, system);
    if (reasons.length) anchors.push({ anchorType: "planet", body: p, orbitAU: p.orbitAU, score: reasons.length });
  });

  system.belts.forEach(b => {
    const reasons = stationEconomicReasonsForBelt(b, system);
    if (reasons.length) anchors.push({ anchorType: "belt", body: b, orbitAU: b.orbitAU, score: reasons.length + 1 });
  });

  if (system.stargateAU) {
    anchors.push({ anchorType: "stargate", body: null, orbitAU: system.stargateAU, score: 4 });
  }

  anchors.sort((a, b) => b.score - a.score);

  const maxStations = clamp(Math.ceil(anchors.length * 0.55), 1, 8);
  const stations = [];
  anchors.slice(0, maxStations).forEach((anchor, i) => {
    const station = createStation(rng, anchor, system, i + 1);
    if (station) stations.push(station);
  });

  return stations;
}

function stationTooltip(s) {
  return `${s.name}
Type: ${s.type}
Anchor: ${s.anchorName}
Orbit: ${s.orbitAU} AU
Scale: ${s.populationClass}
Profitability: ${s.profitability}
Economic reason: ${s.reasons.join(", ")}`;
}

function stationSummary(s) {
  return `${s.name}: ${s.type} at ${s.orbitAU} AU, anchored to ${s.anchorName}. Economic reason: ${s.reasons.join(", ")}. Profitability: ${s.profitability}.`;
}

function generateSystem(criteria) {
  const seedText = criteria.seed || String(Date.now());
  const rng = rngFromSeed(hashSeed(seedText));
  if (criteria.planetCount === "random") criteria.planetCount = weightedRandomPlanetCount(rng);
  const ageLabel = systemAge(rng, criteria.systemAge);
  criteria.ageGyr = ageGyr(rng, ageLabel);
  criteria.metallicity = criteria.metallicity === "random" ? pick(rng, ["low", "normal", "high"]) : criteria.metallicity;
  criteria.richElement = resolveRichElement(rng, criteria.richElement);

  const stellar = buildStellarSystem(rng, criteria);
  stellar.effectiveLuminositySolar = Number(effectiveLuminosity(stellar).toFixed(4));
  stellar.effectiveMassSolar = Number(effectiveMass(stellar).toFixed(3));
  stellar.habitableZoneAU = habitableZone(stellar.effectiveLuminositySolar);
  stellar.frostLineAU = frostLine(stellar.effectiveLuminositySolar);

  const exoticCentre = stellar.stars.some(s => s.type.includes("black_hole") || s.type === "neutron_star" || s.type === "supergiant_star");
  if (exoticCentre) {
    criteria.planetCount = Math.min(criteria.planetCount, Math.max(1, Math.floor(criteria.planetCount * 0.45)));
  }

  const planets = [];
  let start = Math.max(0.02, stellar.habitableZoneAU.inner * between(rng, 0.25, 0.7, 2));

  if (stellar.binary?.stableInnerAU) {
    start = Math.max(start, stellar.binary.stableInnerAU * between(rng, 1.05, 1.4, 2));
  }

  let distance = start;
  const forceGasIndex = criteria.requireGasGiant ? Math.max(1, Math.floor(criteria.planetCount * 0.65)) : -1;

  for (let i = 1; i <= criteria.planetCount; i++) {
    distance *= exoticCentre ? between(rng, 1.8, 3.4, 2) : between(rng, 1.35, 2.05, 2);

    if (stellar.binary?.stableOuterAU && distance > stellar.binary.stableOuterAU) break;

    const generatedPlanet = generatePlanet(rng, i, stellar, criteria, distance, i === forceGasIndex);
    if (exoticCentre) {
      generatedPlanet.orbitalStability = pick(rng, [
        "captured or remnant orbit",
        "marginal long-term stability",
        "stable but dynamically disturbed",
        "eccentric survivor orbit"
      ]);
      generatedPlanet.eccentricity = between(rng, 0.12, 0.55, 2);
    } else {
      generatedPlanet.orbitalStability = "stable generated orbit";
    }
    planets.push(generatedPlanet);
  }

  if (criteria.requireLife || criteria.lifeBias === "forced" || requiredLifeRank(criteria) > 0) {
    forceLifeWorld(rng, planets, stellar, criteria);
  }

  if (criteria.requireColonisation) {
    forceColonisationWorld(rng, planets, stellar, criteria);
  }

  if (criteria.requireOutpost) {
    forceOutpostWorld(rng, planets, stellar, criteria);
  }


  const belts = [];
  if (criteria.requireBelt || chance(rng, 0.45)) {
    belts.push({
      hidden: false,
      type: "asteroid belt",
      orbitAU: Number(between(rng, Math.max(stellar.habitableZoneAU.outer, 0.2), Math.max(stellar.frostLineAU, stellar.habitableZoneAU.outer + 0.4), 3)),
      composition: criteria.richElement && criteria.richElement !== "none" ? richElementLabel(criteria.richElement) : pick(rng, ["silicate-rich", "carbonaceous", "metal-rich", "mixed rock/ice"])
    });
  }
  if (chance(rng, 0.55)) {
    belts.push({
      hidden: false,
      type: "outer cometary belt",
      orbitAU: Number(between(rng, stellar.frostLineAU * 3, stellar.frostLineAU * 18 + 1, 2)),
      composition: criteria.richElement === "water" || criteria.richElement === "nitrogen" ? richElementLabel(criteria.richElement) + " icy bodies" : "volatile-rich icy bodies"
    });
  }

  const gateDistanceAU = stargateDistanceAU({ ...stellar, planets, belts });
  const stationSystemPreview = { ...stellar, planets, belts, stargateAU: gateDistanceAU, richElement: criteria.richElement };
  const stations = generateStations(rng, stationSystemPreview, criteria);

  return {
    seed: seedText,
    realism: "Hard sci-fi; balanced physics with optimistic biology",
    requiredLifeComplexity: criteria.lifeComplexity,
    ageLabel,
    ageGyr: criteria.ageGyr,
    metallicity: criteria.metallicity,
    richElement: criteria.richElement,
    ...stellar,
    stargateAU: gateDistanceAU,
    stargateFormula: "Actual Gate Distance (AU) = max(50 × √(Star Mass in Solar Masses), Outer Edge of Major Planetary/Debris Region)",
    zoneOfControlRadiusKm: ZONE_OF_CONTROL_KM,
    zoneOfControlRadiusAU: Number(ZONE_OF_CONTROL_AU.toFixed(6)),
    planets: planets.sort((a, b) => a.orbitAU - b.orbitAU),
    belts,
    stations
  };
}

function formatStar(star) {
  return `${star.role.toUpperCase()} STAR
Type: ${star.label}
Mass: ${star.massSolar} solar masses
Radius: ${star.radiusSolar} solar radii
Luminosity: ${star.luminositySolar} solar
Surface temperature: ${star.tempK} K
Activity: ${star.activity}
Life stability: ${star.lifeStability}`;
}

function formatSystem(system) {
  let out = "";
  out += `SEED: ${system.seed}\n`;
  out += `REALISM: ${system.realism}\n`;
  out += `ARCHITECTURE: ${system.architecture.replaceAll("_", " ")}\n`;
  out += `SYSTEM AGE: ${system.ageLabel}, ${system.ageGyr} billion years\n`;
  out += `METALLICITY: ${system.metallicity}\n`;
  out += `ELEMENTAL BIAS: ${richElementLabel(system.richElement)}\n`;
  out += `REQUIRED LIFE COMPLEXITY: ${lifeComplexityLabel(system.requiredLifeComplexity)}\n\n`;
  if (system.stars.some(s => s.type.includes("black_hole") || s.type === "neutron_star" || s.type === "supergiant_star")) {
    out += `GENERATION NOTE: Exotic or hostile central object. Planetary bodies may be captured, remnant, shielded, or dependent on non-standard heating. Habitability scores should be treated as speculative.\n\n`;
  }

  out += `STELLAR DATA\n`;
  system.stars.forEach((star, i) => {
    out += formatStar(star) + "\n";
    if (i < system.stars.length - 1) out += "\n";
  });

  if (system.binary) {
    out += `\nBINARY ORBIT
Separation: ${system.binary.separationAU} AU
Eccentricity: ${system.binary.eccentricity}
Stability: ${system.binary.stabilityNote}\n`;
  }

  out += `\nSYSTEM HABITABILITY DATA
Effective luminosity for planetary heating: ${system.effectiveLuminositySolar} solar
Effective central mass for orbital periods: ${system.effectiveMassSolar} solar masses
Habitable zone: ${system.habitableZoneAU.inner}–${system.habitableZoneAU.outer} AU
Frost line: ${system.frostLineAU} AU
Stargate distance: ${system.stargateAU} AU
Stargate formula: ${system.stargateFormula}
Planetary sovereign volume: ${system.zoneOfControlRadiusKm.toLocaleString()} km radius around each planet (${system.zoneOfControlRadiusAU} AU)\n\n`;

  out += `PLANETARY BODIES\n`;
  const visiblePlanets = system.planets.filter(p => !p.hidden);

  if (!visiblePlanets.length) out += `No visible significant planetary bodies.\n`;

  visiblePlanets.forEach((p, idx) => {
    out += `\n${idx + 1}. ${p.name}\n`;
    out += `Type: ${p.type}\n`;
    out += `Orbit: ${p.orbitAU} AU, eccentricity ${p.eccentricity}\n`;
    out += `Year: ${p.yearEarthYears} Earth years\n`;
    out += `Day/night cycle: ${p.dayNightCycle}\n`;
    out += `Average temperature: ${p.avgTempK} K / ${p.avgTempC} °C\n`;
    out += `Radius: ${p.radiusEarth}× Earth radius\n`;
    out += `Circumference: ${planetCircumferenceKm(p.radiusEarth).toLocaleString()} km\n`;
    out += `Mass/radius/gravity: ${p.massEarth} M⊕, ${p.radiusEarth} R⊕, ${p.surfaceGravityG} g\n`;
    out += `Atmosphere: ${p.atmosphere}\n`;
    out += `Composition: ${p.composition}\n`;
    out += `Tectonically active: ${p.tectonicallyActive ? "yes" : "no"}\n`;
    out += `Magnetic field: ${p.magneticField ? "yes" : "no"}\n`;
    out += `Rings: ${p.rings ? "yes" : "no"}\n`;
    out += `Life: ${p.supportsLife}\n`;
    out += `Colonisation: ${isSuitableForColonisation(p, system) ? "suitable for colonisation" : "not suitable for straightforward colonisation"}\n`;
    out += `Outpost: ${isSuitableForOutpost(p, system) ? "suitable for economic outpost" : "not recommended unless strategically necessary"}\n`;
    const notableInterest = [...new Set([...biologicalAndColonisationInterest(p, system), ...notableEconomicInterestForBody(p, system)])];
    if (notableInterest.length) out += `Notable interest: ${notableInterest.join(", ")}\n`;
    if (p.supportsLife === "Microbial subsurface life sustained by geological activity") {
      out += `Life support note: outside normal surface-habitable conditions; sustained by internal geological activity.\n`;
    }

    out += `Visible moons/satellites: ${p.moons.filter(m => !m.hidden).length}\n`;

    p.moons.filter(m => !m.hidden).forEach(m => {
      out += `  - ${m.name}: ${m.sizeClass}; estimated circumference ${moonCircumferenceKm(m.sizeClass).toLocaleString()} km; period ${m.orbitalPeriodDays} days; ${m.composition}; `;
      out += `tidal heating ${m.tidalHeating ? "yes" : "no"}; atmosphere ${m.atmosphere}; `;
      out += `subsurface ocean ${m.subsurfaceOcean ? "yes" : "no"}; life potential: ${m.lifePotential}\n`;
    });
  });

  const visibleStations = (system.stations || []).filter(s => !s.hidden);
  if (visibleStations.length) {
    out += `\nSTATIONS / ORBITAL HABITATS\n`;
    visibleStations.forEach(s => {
      out += `- ${s.name}: ${s.type}; orbit ${s.orbitAU} AU; anchor ${s.anchorName}; ${s.populationClass}; ${s.profitability}; reason: ${s.reasons.join(", ")}\n`;
    });
  }

  const visibleBelts = system.belts.filter(b => !b.hidden);
  if (visibleBelts.length) {
    out += `\nBELTS / SMALL BODY REGIONS\n`;
    visibleBelts.forEach(b => {
      out += `- ${b.type}: ${b.orbitAU} AU, ${b.composition}\n`;
    });
  }

  return out;
}

function readCriteria() {
  return {
    architecture: document.getElementById("architecture").value,
    starType: document.getElementById("starType").value,
    secondaryStarType: document.getElementById("secondaryStarType").value,
    planetCount: document.getElementById("planetCount").value === "random"
      ? "random"
      : Number(document.getElementById("planetCount").value),
    lifeBias: document.getElementById("lifeBias").value,
    lifeComplexity: document.getElementById("lifeComplexity").value,
    systemAge: document.getElementById("systemAge").value,
    metallicity: document.getElementById("metallicity").value,
    richElement: document.getElementById("richElement").value,
    seed: document.getElementById("seed").value.trim(),
    requireLife: document.getElementById("requireLife").checked,
    requireBelt: document.getElementById("requireBelt").checked,
    requireGasGiant: document.getElementById("requireGasGiant").checked,
    requireColonisation: document.getElementById("requireColonisation").checked,
    requireOutpost: document.getElementById("requireOutpost").checked,
    allowTidallyLockedLife: document.getElementById("allowTidallyLockedLife").checked,
    showStargate: document.getElementById("showStargate")?.checked ?? true,
    showZonesOfControl: document.getElementById("showZonesOfControl")?.checked ?? true,
    allowStations: document.getElementById("allowStations")?.checked ?? true
  };
}


function updateMutableSeed(action) {
  if (!lastSystem) return;
  const base = lastSystem.seed || "system";
  const stamp = hashSeed(`${base}:${action}:${Date.now()}`).toString(36);
  lastSystem.seed = `${base.split("|")[0]}|${action}|${stamp}`;
}

function render() {
  const output = document.getElementById("output");
  const actions = document.getElementById("actions");
  const summary = document.getElementById("systemSummary");

  if (!lastSystem) {
    output.textContent = "Set criteria, then generate a system.";
    actions.innerHTML = "";
    if (summary) summary.textContent = "Generate a system to show summary.";
    renderVisuals();
    return;
  }

  output.textContent = formatSystem(lastSystem);
  if (summary) summary.innerHTML = `<strong>System summary:</strong><div class="summary-paragraphs">${systemSummaryText(lastSystem)}</div>`;
  renderActions();
  renderVisuals();
}

function makeSmallButton(text, fn) {
  const btn = document.createElement("button");
  btn.className = "small";
  btn.type = "button";
  btn.textContent = text;
  btn.addEventListener("click", fn);
  return btn;
}

function renderActions() {
  const actions = document.getElementById("actions");
  actions.innerHTML = "";

  if (!lastSystem) return;

  actions.appendChild(makeSmallButton("Regenerate stars/system", () => {
    const criteria = { ...lastCriteria, seed: String(Date.now()) };
    lastCriteria = criteria;
    lastSystem = generateSystem(criteria);
    render();
  }));


  (lastSystem.stations || []).forEach((station, index) => {
    addButton(`${station.hidden ? "Show" : "Hide"} ${station.name}`, () => {
      station.hidden = !station.hidden;
      updateMutableSeed(`${station.hidden ? "hide" : "show"}-${station.name}`);
      render();
    });

    addButton(`Regenerate ${station.name}`, () => {
      const rng = systemRng(`station-${index}`);
      const anchor =
        station.anchorType === "planet"
          ? { anchorType: "planet", body: lastSystem.planets.find(p => p.name === station.anchorName), orbitAU: station.orbitAU }
          : station.anchorType === "belt"
            ? { anchorType: "belt", body: lastSystem.belts.find(b => b.type === station.anchorName) || lastSystem.belts[0], orbitAU: station.orbitAU }
            : { anchorType: "stargate", body: null, orbitAU: lastSystem.stargateAU };

      const regenerated = createStation(rng, anchor, lastSystem, index + 1);
      if (regenerated) {
        regenerated.name = station.name;
        regenerated.hidden = station.hidden;
        lastSystem.stations[index] = regenerated;
        updateMutableSeed(`regen-station-${station.name}`);
        render();
      }
    });
  });

  lastSystem.belts.forEach((belt, index) => {
    actions.appendChild(makeSmallButton(`${belt.hidden ? "Show" : "Hide"} ${belt.type}`, () => {
      belt.hidden = !belt.hidden;
      render();
    }));

    actions.appendChild(makeSmallButton(`Regenerate ${belt.type}`, () => {
      const rng = systemRng(`belt-${index}`);
      belt.orbitAU = Number(between(rng, Math.max(lastSystem.habitableZoneAU.outer, 0.2), Math.max(lastSystem.frostLineAU * 3, lastSystem.habitableZoneAU.outer + 0.4), 3));
      belt.composition = pick(rng, ["silicate-rich", "carbonaceous", "metal-rich", "mixed rock/ice", "volatile-rich icy bodies"]);
      render();
    }));
  });
}

document.getElementById("generateBtn").addEventListener("click", () => {
  lastCriteria = readCriteria();
  lastSystem = generateSystem({ ...lastCriteria });
  render();
});

document.getElementById("copyBtn").addEventListener("click", async () => {
  const text = document.getElementById("output").textContent;
  await navigator.clipboard.writeText(text);
});


["showStargate", "showZonesOfControl", "allowStations"].forEach(id => {
  document.addEventListener("change", event => {
    if (event.target && event.target.id === id && lastSystem) {
      lastCriteria = { ...lastCriteria, [id]: event.target.checked };
      render();
    }
  });
});

document.getElementById("downloadJsonBtn").addEventListener("click", () => {
  if (!lastSystem) return;
  const blob = new Blob([JSON.stringify(lastSystem, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "star-system.json";
  a.click();
  URL.revokeObjectURL(url);
});


function escSvg(value) {
  return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
}


function planetCircumferenceKm(radiusEarth) {
  return Math.round(2 * Math.PI * radiusEarth * 6371);
}

function moonRadiusKmFromSize(sizeClass) {
  if (String(sizeClass).includes("large")) return 1700;
  if (String(sizeClass).includes("medium")) return 750;
  if (String(sizeClass).includes("small")) return 250;
  return 60;
}

function moonCircumferenceKm(sizeClass) {
  return Math.round(2 * Math.PI * moonRadiusKmFromSize(sizeClass));
}


function escAttr(value) {
  return escSvg(value).replaceAll("'", "&#39;");
}

function tooltipAttrs(text) {
  return `data-tooltip="${escAttr(text)}"`;
}

function initCustomTooltips() {
  const tip = document.getElementById("customTooltip");
  if (!tip) return;

  document.addEventListener("mousemove", event => {
    const target = event.target.closest?.("[data-tooltip]");
    if (!target) {
      tip.style.display = "none";
      return;
    }

    tip.textContent = target.getAttribute("data-tooltip") || "";
    tip.style.display = "block";

    const pad = 14;
    const rect = tip.getBoundingClientRect();
    let x = event.clientX + pad;
    let y = event.clientY + pad;

    if (x + rect.width > window.innerWidth) x = event.clientX - rect.width - pad;
    if (y + rect.height > window.innerHeight) y = event.clientY - rect.height - pad;

    tip.style.left = `${Math.max(8, x)}px`;
    tip.style.top = `${Math.max(8, y)}px`;
  });

  document.addEventListener("mouseleave", () => {
    tip.style.display = "none";
  });
}

function svgTitle(text) {
  return `<title>${escSvg(text)}</title>`;
}

function starTooltip(star) {
  const info = starGeneralInfo(star);
  return `${star.role.toUpperCase()} STAR
Type: ${star.label}
Radius: ${star.radiusSolar}× Sol
Circumference: ${starCircumferenceMillionKm(star.radiusSolar)} million km
Surface temperature: ${star.tempK} K${info ? `
Notable activity: ${info}` : ""}`;
}

function planetTooltip(p, system) {
  return `${p.name}
Type: ${p.type}
Orbit: ${p.orbitAU} AU
Orbital stability: ${p.orbitalStability || "stable generated orbit"}
Year: ${p.yearEarthYears} Earth years
Average temperature: ${p.avgTempK} K / ${p.avgTempC} °C
Radius: ${p.radiusEarth}× Earth radius
Circumference: ${planetCircumferenceKm(p.radiusEarth).toLocaleString()} km
Mass/radius/gravity: ${p.massEarth} M⊕, ${p.radiusEarth} R⊕, ${p.surfaceGravityG} g
Atmosphere: ${p.atmosphere}
Composition: ${p.composition}
Life: ${p.supportsLife}
Habitation: ${isSuitableForHabitation(p, system) ? "suitable for colonisation" : "not suitable for straightforward colonisation"}
Notable interest: ${[...new Set([...biologicalAndColonisationInterest(p, system), ...notableEconomicInterestForBody(p, system)])].join(", ") || "none flagged"}
Sovereign volume: ${system.zoneOfControlRadiusKm?.toLocaleString?.() || "1,000,000"} km radius`;
}

function moonTooltip(m) {
  return `${m.name}
Size: ${m.sizeClass}
Estimated circumference: ${moonCircumferenceKm(m.sizeClass).toLocaleString()} km
Orbital period: ${m.orbitalPeriodDays} days
Composition: ${m.composition}
Tidal heating: ${m.tidalHeating ? "yes" : "no"}
Atmosphere: ${m.atmosphere}
Subsurface ocean: ${m.subsurfaceOcean ? "yes" : "no"}
Life potential: ${m.lifePotential}`;
}

function beltTooltip(b) {
  return `${b.type}
Orbit: ${b.orbitAU} AU
Composition: ${b.composition}`;
}

function stargateTooltip(system) {
  return `Stargate
Distance: ${system.stargateAU} AU
Formula: ${system.stargateFormula}
Reference: Sol baseline = 50 AU`;
}

function bodyFill(type) {
  type = String(type || '').toLowerCase();
  if (type.includes('red')) return '#d9664f';
  if (type.includes('orange')) return '#f0a34a';
  if (type.includes('yellow')) return '#f4d35e';
  if (type.includes('white')) return '#d8e8ff';
  if (type.includes('f_type') || type.includes('f-type')) return '#f6f0c8';
  if (type.includes('a_type') || type.includes('a-type')) return '#cfe6ff';
  if (type.includes('giant_star') || type.includes('giant star')) return '#ffb15c';
  if (type.includes('supergiant')) return '#ff7b5c';
  if (type.includes('neutron')) return '#e8f5ff';
  if (type.includes('black_hole') || type.includes('black hole')) return '#050509';
  if (type.includes('gas')) return '#c49a6c';
  if (type.includes('ice giant')) return '#8cc6d7';
  if (type.includes('ocean')) return '#3f8fc5';
  if (type.includes('ice')) return '#a9d6e5';
  if (type.includes('carbon')) return '#6f6a60';
  if (type.includes('super')) return '#b77a4f';
  if (type.includes('dwarf')) return '#8a8f98';
  if (type.includes('iron-rich')) return '#8d6b5c';
  if (type.includes('terrestrial')) return '#9c7a56';
  if (type.includes('rock')) return '#8d7b68';
  return '#9aa6b2';
}
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

const KM_PER_AU = 149597870.7;
const ZONE_OF_CONTROL_KM = 1000000;
const ZONE_OF_CONTROL_AU = ZONE_OF_CONTROL_KM / KM_PER_AU;

function outerMajorRegionAU(system) {
  const planetMax = Math.max(0, ...system.planets.map(p => p.orbitAU));
  const beltMax = Math.max(0, ...system.belts.map(b => b.orbitAU));
  return Math.max(planetMax, beltMax, system.frostLineAU || 0);
}

function stargateDistanceAU(system) {
  const massTerm = 50 * Math.sqrt(Math.max(system.effectiveMassSolar || system.totalMassSolar || 1, 0.0001));
  const outerEdge = outerMajorRegionAU(system);
  return Number(Math.max(massTerm, outerEdge).toFixed(2));
}

function displayOptions() {
  return {
    stargate: document.getElementById("showStargate")?.checked ?? true,
    zones: document.getElementById("showZonesOfControl")?.checked ?? true,
    stations: document.getElementById("allowStations")?.checked ?? true
  };
}

function systemProjectionWidth(maxOrbit, bodyCount, expansion = null) {
  // Keep the canvas wide enough to scroll, but not so huge that content becomes tiny.
  const pxPerAU = maxOrbit <= 5 ? 680 : maxOrbit <= 20 ? 360 : maxOrbit <= 80 ? 150 : 75;
  let width = Math.max(3400, 320 + maxOrbit * pxPerAU, bodyCount * 440);

  if (expansion?.enabled) {
    // Add real space for the crowded inner scale, but keep the total size controlled.
    const extra = Math.min(2200, Math.max(900, expansion.expandUntilAU * 1250));
    width += extra;
  }

  return Math.round(width);
}

function scaledSystemX(au, maxOrbit, left, usableWidth) {
  // Hybrid scale: linear close to the star, compressed beyond 10 AU.
  // This makes inner planets readable while still showing far debris/stargate positions.
  const knee = Math.min(10, Math.max(2, maxOrbit * 0.25));
  if (au <= knee) return left + (au / knee) * usableWidth * 0.58;
  const farFraction = Math.log1p(au - knee) / Math.log1p(maxOrbit - knee);
  return left + usableWidth * (0.58 + farFraction * 0.42);
}

function visibleSystemRadius(p) {
  return p.type.includes("giant")
    ? clamp(16 + p.radiusEarth * 1.35, 26, 46)
    : clamp(11 + p.radiusEarth * 5.6, 16, 30);
}


function visibleMoonsForPlanet(p) {
  return p.moons.filter(m => !m.hidden);
}


function isInHabitableZone(p, system) {
  return p.orbitAU >= system.habitableZoneAU.inner && p.orbitAU <= system.habitableZoneAU.outer;
}

function economicInterestTextForComposition(composition, richElement) {
  const text = String(composition || "").toLowerCase();
  const interests = [];
  if (richElement && richElement !== "none") interests.push(`higher than expected ${richElementLabel(richElement)} content`);
  if (text.includes("metal") || text.includes("iron")) interests.push("metal-rich material");
  if (text.includes("carbon")) interests.push("carbonaceous chemistry");
  if (text.includes("volatile") || text.includes("ice") || text.includes("water")) interests.push("useful volatiles and ice");
  if (text.includes("uranium") || text.includes("thorium") || text.includes("radiogenic")) interests.push("radiogenic heavy elements");
  if (text.includes("gold") || text.includes("noble")) interests.push("trace noble metals");
  if (text.includes("helium-3")) interests.push("helium-3 fuel potential");
  return [...new Set(interests)];
}

function systemCompositionSentence(system) {
  if (!system.richElement || system.richElement === "none") return "";
  return `The system shows a higher than expected concentration of ${richElementLabel(system.richElement)} material. `;
}



function starCircumferenceKm(radiusSolar) {
  return Math.round(2 * Math.PI * radiusSolar * 696340);
}

function starCircumferenceMillionKm(radiusSolar) {
  return Number((starCircumferenceKm(radiusSolar) / 1000000).toFixed(3));
}

function starGeneralInfo(star) {
  const notes = [];

  const activity = String(star.activity || "").toLowerCase();
  if (
    activity.includes("flare") ||
    activity.includes("strong uv") ||
    activity.includes("high uv") ||
    activity.includes("intense") ||
    activity.includes("violent") ||
    activity.includes("unstable") ||
    activity.includes("radiation") ||
    activity.includes("pulsar") ||
    activity.includes("magnetar") ||
    activity.includes("accretion") ||
    activity.includes("tidal") ||
    activity.includes("mass loss")
  ) {
    notes.push(star.activity);
  }

  if (star.type === "f_type" || star.type === "a_type") notes.push("strong UV output");
  if (star.type === "white_dwarf") notes.push("compact stellar remnant");
  if (star.type === "neutron_star") notes.push("extreme radiation environment");
  if (star.type.includes("black_hole")) notes.push("no natural stellar light; orbit stability depends on capture/accretion environment");
  if (star.type === "giant_star" || star.type === "supergiant_star") notes.push("evolved unstable high-output star");

  return [...new Set(notes)].join("; ");
}

function isExoticCentre(system) {
  return system.stars.some(s =>
    s.type.includes("black_hole") ||
    s.type === "neutron_star" ||
    s.type === "supergiant_star"
  );
}

function orbitalStabilityNote(system) {
  if (system.stars.some(s => s.type.includes("black_hole"))) {
    return "Orbital stability is uncertain: these worlds are probably captured, remnant, or shepherded bodies rather than a calm native planetary family.";
  }
  if (system.stars.some(s => s.type === "neutron_star")) {
    return "Orbital stability is hostile: any planets are likely survivors or captured bodies under intense radiation conditions.";
  }
  if (system.stars.some(s => s.type === "supergiant_star")) {
    return "Orbital stability is short-lived: the central star is massive, bright, and unstable on planetary timescales.";
  }
  if (system.binary) {
    return "Orbital stability is shaped by the companion star, so the safest planets are those inside the generated stable orbital region.";
  }
  return "";
}


function isStrongBiosphere(planet) {
  return [
    "Simple multicellular life",
    "Complex multicellular life",
    "Complex animal-like life",
    "Technological civilisation candidate"
  ].includes(planet.supportsLife);
}

function isTerrestrialForHabitation(planet) {
  return [
    "terrestrial",
    "super-Earth",
    "carbon-rich terrestrial",
    "iron-rich terrestrial",
    "ocean world",
    "icy terrestrial"
  ].includes(planet.type);
}

function hasSubstantialAtmosphere(planet) {
  const atmosphere = String(planet.atmosphere || "").toLowerCase();
  return atmosphere &&
    !atmosphere.includes("negligible") &&
    !atmosphere.includes("trace exosphere") &&
    !atmosphere.includes("none") &&
    !atmosphere.includes("mineral vapour");
}

function hasStrongEconomicReasonForOutpost(planet, system) {
  const interests = notableEconomicInterestForBody(planet, system);
  return interests.some(item =>
    item.includes("metal") ||
    item.includes("noble") ||
    item.includes("radiogenic") ||
    item.includes("helium-3") ||
    item.includes("volatiles")
  );
}

function isSuitableForColonisation(planet, system) {
  return isTerrestrialForHabitation(planet) &&
    hasSubstantialAtmosphere(planet) &&
    isInHabitableZone(planet, system);
}

function isSuitableForOutpost(planet, system) {
  return isTerrestrialForHabitation(planet) &&
    hasStrongEconomicReasonForOutpost(planet, system);
}

function isSuitableForHabitation(planet, system) {
  return isSuitableForColonisation(planet, system);
}

function biologicalAndColonisationInterest(planet, system) {
  const notes = [];
  if (isStrongBiosphere(planet)) notes.push("strong biosphere");
  if (isSuitableForColonisation(planet, system)) notes.push("suitable for colonisation");
  if (isSuitableForOutpost(planet, system)) notes.push("suitable for economic outpost");
  return notes;
}

function notableEconomicInterestForBody(body, system) {
  const interests = economicInterestTextForComposition(body.composition, system.richElement);
  const notable = interests.filter(item =>
    item.includes("metal") ||
    item.includes("noble") ||
    item.includes("radiogenic") ||
    item.includes("helium-3") ||
    item.includes("volatiles")
  );
  return [...new Set(notable)];
}

function compactPlanetClassSummary(planets, system) {
  const hz = planets.filter(p => isInHabitableZone(p, system));
  const giants = planets.filter(p => p.type.includes("giant"));
  const rocky = planets.filter(p => !p.type.includes("giant") && !p.type.includes("dwarf"));
  const dwarfs = planets.filter(p => p.type.includes("dwarf"));
  const parts = [];
  if (rocky.length) parts.push(`${rocky.length} rocky/icy terrestrial-class world${rocky.length === 1 ? "" : "s"}`);
  if (giants.length) parts.push(`${giants.length} gas or ice giant${giants.length === 1 ? "" : "s"}`);
  if (dwarfs.length) parts.push(`${dwarfs.length} dwarf body${dwarfs.length === 1 ? "" : "ies"}`);
  if (hz.length) parts.push(`${hz.length} within the habitable zone: ${hz.map(p => p.name).join(", ")}`);
  return parts.join("; ");
}


function paragraphsHtml(parts) {
  return parts
    .filter(part => part && String(part).trim())
    .map(part => `<p>${escSvg(String(part).trim())}</p>`)
    .join("");
}

function systemSummaryText(system) {
  const visiblePlanets = system.planets.filter(p => !p.hidden);
  const belts = system.belts.filter(b => !b.hidden);
  const lifeWorlds = visiblePlanets
    .filter(p => !["None", "Prebiotic chemistry"].includes(p.supportsLife))
    .sort((a, b) => b.habitabilityScore - a.habitabilityScore);
  const prebioticWorlds = visiblePlanets.filter(p => p.supportsLife === "Prebiotic chemistry");
  const bestLife = lifeWorlds[0];

  const starText = system.stars.map(s => {
    const info = starGeneralInfo(s);
    return `${s.label}: radius ${s.radiusSolar}× Sol, circumference ${starCircumferenceMillionKm(s.radiusSolar)} million km${info ? `, ${info}` : ""}`;
  }).join("; ");

  const parts = [];
  parts.push(`Star: ${starText}.`);

  if (system.richElement && system.richElement !== "none") {
    parts.push(`Composition: higher than expected ${richElementLabel(system.richElement)} material is present across the system.`);
  }

  if (visiblePlanets.length) {
    const planetSummary = compactPlanetClassSummary(visiblePlanets, system);
    parts.push(`Planets: ${planetSummary || `${visiblePlanets.length} major visible worlds`}.`);
  } else {
    parts.push(`Planets: no major visible worlds.`);
  }

  const stability = orbitalStabilityNote(system);
  if (stability) parts.push(stability);

  const economicNotes = [];
  visiblePlanets.forEach(p => {
    const interest = [
      ...biologicalAndColonisationInterest(p, system),
      ...notableEconomicInterestForBody(p, system)
    ];
    const uniqueInterest = [...new Set(interest)];
    if (uniqueInterest.length) economicNotes.push(`${p.name}: ${uniqueInterest.join(", ")}`);
  });
  belts.forEach(b => {
    const interest = notableEconomicInterestForBody(b, system);
    if (interest.length) economicNotes.push(`${b.type}: ${interest.join(", ")}`);
  });
  if (economicNotes.length) {
    parts.push(`Economic notes: ${economicNotes.slice(0, 4).join("; ")}.`);
  }

  const visibleStations = (system.stations || []).filter(s => !s.hidden);
  if (visibleStations.length) {
    parts.push(`Stations and habitats: ${visibleStations.map(s => `${s.name} (${s.type}, ${s.anchorName})`).join("; ")}.`);
  }

  const habitableForSettlement = visiblePlanets.filter(p => isSuitableForHabitation(p, system));
  if (habitableForSettlement.length) {
    parts.push(`Habitation: ${habitableForSettlement.map(p => p.name).join(", ")} ${habitableForSettlement.length === 1 ? "is" : "are"} suitable for colonisation.`);
  } else {
    parts.push(`Habitation: no visible planet is currently suitable for straightforward habitation/colonisation.`);
  }

  if (bestLife) {
    const lifeNote = bestLife.supportsLife === "Microbial subsurface life sustained by geological activity"
      ? " This is a protected subsurface ecology, not normal surface habitability."
      : "";
    parts.push(`Life: strongest reading is ${bestLife.name}, with ${bestLife.supportsLife.toLowerCase()}.${lifeNote}`);
  } else if (prebioticWorlds.length) {
    parts.push(`Life: no confirmed living biosphere, but prebiotic chemistry appears on ${prebioticWorlds.map(p => p.name).join(", ")}.`);
  } else {
    parts.push(`Life: no confirmed life signatures on visible planets.`);
  }

  return paragraphsHtml(parts);
}

function planetDescription(p, system = null) {
  const moons = visibleMoonsForPlanet(p);
  const hz = system && isInHabitableZone(p, system) ? " It sits within the habitable zone." : "";
  const interests = system ? economicInterestTextForComposition(p.composition, system.richElement) : economicInterestTextForComposition(p.composition, null);

  const parts = [];
  parts.push(`${p.name}: ${p.type}, orbiting at ${p.orbitAU} AU.${hz}`);

  parts.push(`Size and conditions: radius ${p.radiusEarth}× Earth, circumference ${planetCircumferenceKm(p.radiusEarth).toLocaleString()} km, surface gravity ${p.surfaceGravityG} g, average temperature ${p.avgTempC} °C.`);

  parts.push(`Atmosphere and composition: ${p.atmosphere}. ${p.composition}.`);

  const settlementNotes = system ? biologicalAndColonisationInterest(p, system) : [];
  const combinedInterest = [...new Set([...settlementNotes, ...interests])];
  if (combinedInterest.length) parts.push(`Notable interest: ${combinedInterest.join(", ")}.`);

  const features = [];
  if (p.rings) features.push("visible rings");
  if (p.magneticField) features.push("magnetic field detected");
  if (p.tectonicallyActive) features.push("geological activity detected");
  if (p.orbitalStability && p.orbitalStability !== "stable generated orbit") features.push(`orbit note: ${p.orbitalStability}`);
  if (p.tidallyLocked) features.push("tidally locked day/night faces");
  if (features.length) parts.push(`Features: ${features.join("; ")}.`);

  if (system && isSuitableForColonisation(p, system)) {
    parts.push(`Colonisation: suitable for colonisation.`);
  } else if (system) {
    parts.push(`Colonisation: not suitable for straightforward colonisation.`);
  }
  if (system && isSuitableForOutpost(p, system) && !isSuitableForColonisation(p, system)) {
    parts.push(`Outpost: suitable for an enclosed/self-sustaining economic outpost.`);
  }

  let lifeText = `Life: ${p.supportsLife}.`;
  if (p.supportsLife === "Microbial subsurface life sustained by geological activity") {
    lifeText += ` This is not surface habitability; it depends on internal heat, chemistry, and protected subsurface water.`;
  }
  parts.push(lifeText);

  parts.push(moons.length
    ? `Moons: ${moons.length} visible moon${moons.length === 1 ? "" : "s"}.`
    : `Moons: no visible moons.`);

  return paragraphsHtml(parts);
}

function moonDescription(m) {
  const parts = [];
  parts.push(`${m.name}: ${m.sizeClass}, roughly ${moonRadiusKmFromSize(m.sizeClass).toLocaleString()} km in estimated radius and ${moonCircumferenceKm(m.sizeClass).toLocaleString()} km around.`);
  parts.push(`Orbit and composition: orbital period ${m.orbitalPeriodDays} days; ${m.composition}.`);

  const notes = [];
  if (m.tidalHeating) notes.push("tidal heating detected");
  if (m.subsurfaceOcean) notes.push("possible subsurface ocean");
  if (notes.length) parts.push(`Notable features: ${notes.join("; ")}.`);

  parts.push(`Atmosphere: ${m.atmosphere}. Life potential: ${m.lifePotential}.`);
  return paragraphsHtml(parts);
}


function regeneratePlanetByIndex(index) {
  if (!lastSystem || !lastCriteria || !lastSystem.planets[index]) return;
  const planet = lastSystem.planets[index];
  const rng = systemRng(`planet-section-${index}`);
  const replacement = generatePlanet(rng, index + 1, lastSystem, lastCriteria, planet.orbitAU, false, planet.name);
  replacement.hidden = planet.hidden;
  lastSystem.planets[index] = replacement;
  updateMutableSeed(`regen-planet-${planet.name}`);
  render();
}

function regenerateMoonByIndex(planetIndex, moonIndex) {
  if (!lastSystem || !lastSystem.planets[planetIndex]) return;
  const planet = lastSystem.planets[planetIndex];
  const moon = planet.moons[moonIndex];
  if (!moon) return;
  const rng = systemRng(`moon-section-${planetIndex}-${moonIndex}`);
  const newMoon = moonStats(rng, planet, 1)[0];
  newMoon.name = moon.name;
  newMoon.hidden = moon.hidden;
  planet.moons[moonIndex] = newMoon;
  updateMutableSeed(`regen-moon-${moon.name}`);
  render();
}

function togglePlanetHiddenByIndex(index) {
  if (!lastSystem || !lastSystem.planets[index]) return;
  const planet = lastSystem.planets[index];
  planet.hidden = !planet.hidden;
  updateMutableSeed(`${planet.hidden ? "hide" : "show"}-${planet.name}`);
  render();
}

function toggleMoonHiddenByIndex(planetIndex, moonIndex) {
  if (!lastSystem || !lastSystem.planets[planetIndex]) return;
  const moon = lastSystem.planets[planetIndex].moons[moonIndex];
  if (!moon) return;
  moon.hidden = !moon.hidden;
  updateMutableSeed(`${moon.hidden ? "hide" : "show"}-${moon.name}`);
  render();
}

function initProjectionSectionControls() {
  document.addEventListener("click", event => {
    const btn = event.target.closest?.("[data-toggle-planet-section], [data-toggle-moons-section], [data-regenerate-planet], [data-hide-planet], [data-regenerate-moon], [data-hide-moon]");
    if (!btn) return;

    const card = btn.closest(".planet-card");

    if (btn.hasAttribute("data-regenerate-planet")) {
      regeneratePlanetByIndex(Number(btn.getAttribute("data-regenerate-planet")));
      return;
    }

    if (btn.hasAttribute("data-hide-planet")) {
      togglePlanetHiddenByIndex(Number(btn.getAttribute("data-hide-planet")));
      return;
    }

    if (btn.hasAttribute("data-regenerate-moon")) {
      regenerateMoonByIndex(Number(btn.getAttribute("data-planet-index")), Number(btn.getAttribute("data-moon-index")));
      return;
    }

    if (btn.hasAttribute("data-hide-moon")) {
      toggleMoonHiddenByIndex(Number(btn.getAttribute("data-planet-index")), Number(btn.getAttribute("data-moon-index")));
      return;
    }

    if (!card) return;

    if (btn.hasAttribute("data-toggle-planet-section")) {
      card.classList.toggle("collapsed");
      btn.textContent = card.classList.contains("collapsed") ? "Expand planet section" : "Minimise planet section";
    }

    if (btn.hasAttribute("data-toggle-moons-section")) {
      card.classList.toggle("moons-collapsed");
      btn.textContent = card.classList.contains("moons-collapsed") ? "Show moons" : "Minimise moons";
    }
  });
}

function renderVisuals() {
  const systemTarget = document.getElementById('systemVisual');
  const planetTarget = document.getElementById('planetVisuals');
  if (!systemTarget || !planetTarget) return;
  if (!lastSystem) {
    systemTarget.textContent = 'Generate a system to draw projection.';
    planetTarget.textContent = 'Generate a system to draw planet views.';
    return;
  }
  systemTarget.innerHTML = renderSystemSvg(lastSystem);
  const planetSections = renderPlanetSvgs(lastSystem);
  planetTarget.innerHTML = '';
  if (typeof planetSections === 'string') planetTarget.innerHTML = planetSections;
  else planetTarget.appendChild(planetSections);
}


function detectDenseInnerCluster(planets, belts, gateAU) {
  const bodies = [
    ...planets.map(p => ({ orbitAU: p.orbitAU, kind: "planet" })),
    ...belts.map(b => ({ orbitAU: b.orbitAU, kind: "belt" }))
  ].filter(b => Number.isFinite(b.orbitAU));

  if (bodies.length < 3) return null;

  const sorted = bodies.sort((a, b) => a.orbitAU - b.orbitAU);
  const innerLimit = Math.min(2.0, Math.max(0.6, sorted[Math.min(sorted.length - 1, 4)].orbitAU * 1.2));
  const innerBodies = sorted.filter(b => b.orbitAU <= innerLimit);

  if (innerBodies.length < 3) return null;

  let closePairs = 0;
  for (let i = 1; i < innerBodies.length; i++) {
    if ((innerBodies[i].orbitAU - innerBodies[i - 1].orbitAU) < 0.22) closePairs++;
  }

  if (closePairs < 2) return null;

  return {
    enabled: true,
    expandUntilAU: Number(Math.min(Math.max(innerLimit, innerBodies[innerBodies.length - 1].orbitAU + 0.2), Math.max(1.4, gateAU * 0.25)).toFixed(2)),
    factor: 4.0
  };
}

function expandedSystemX(au, maxOrbit, left, right, width, expansion) {
  const usable = width - left - right;
  if (!expansion?.enabled) return left + au * usable / maxOrbit;

  const e = expansion.expandUntilAU;

  // Allocate a fixed large share of the canvas to the crowded inner region.
  // Outer distances remain ordered and labelled correctly, but get less visual priority.
  const innerShare = maxOrbit <= e ? 1 : 0.52;
  const innerWidth = usable * innerShare;
  const outerWidth = usable - innerWidth;

  if (au <= e || maxOrbit <= e) {
    return left + (au / e) * innerWidth;
  }

  return left + innerWidth + ((au - e) / (maxOrbit - e)) * outerWidth;
}

function expandedTickValues(maxOrbit, expansion) {
  if (!expansion?.enabled) {
    const step = maxOrbit <= 1 ? 0.1 : maxOrbit <= 5 ? 0.5 : maxOrbit <= 15 ? 1 : 5;
    const ticks = [];
    for (let au = 0; au <= maxOrbit + 0.0001; au += step) ticks.push(Number(au.toFixed(2)));
    return ticks;
  }

  const ticks = [];
  const e = expansion.expandUntilAU;
  const innerStep = e <= 1 ? 0.1 : 0.2;
  for (let au = 0; au <= e + 0.0001; au += innerStep) ticks.push(Number(au.toFixed(2)));

  const outerStep = maxOrbit <= 10 ? 1 : maxOrbit <= 80 ? 5 : 10;
  let startOuter = Math.ceil(e / outerStep) * outerStep;
  if (startOuter <= e) startOuter += outerStep;
  for (let au = startOuter; au <= maxOrbit + 0.0001; au += outerStep) ticks.push(Number(au.toFixed(2)));

  return [...new Set(ticks)];
}

function assignProjectionRows(items, xForAU, minGapPx = 92) {
  // All system bodies are placed above the AU axis.
  // Rows are staggered upward to avoid icon/label collisions while x-position remains true to AU scale.
  const rows = [-54, -96, -138, -180, -222, -264];
  const placed = [];

  return items.map((item, index) => {
    const x = xForAU(item.orbitAU);
    let row = rows[Math.min(index, rows.length - 1)];

    for (const candidate of rows) {
      const conflict = placed.some(p => p.row === candidate && Math.abs(p.x - x) < minGapPx);
      if (!conflict) {
        row = candidate;
        break;
      }
    }

    placed.push({ x, row });
    return { item, x, row };
  });
}


function renderStationSections(system) {
  const opts = displayOptions();
  const stations = opts.stations ? (system.stations || []).filter(s => !s.hidden) : [];
  if (!stations.length) return "";
  let html = `<div class="planet-card"><div class="planet-card-header">`;
  html += `<div class="planet-card-title">Stations / orbital habitats</div>`;
  stations.forEach(s => {
    html += `<div class="moon-summary" ${tooltipAttrs(stationTooltip(s))}>${paragraphsHtml([stationSummary(s)])}</div>`;
  });
  html += `</div></div>`;
  return html;
}

function renderSystemSvg(system) {
  const opts = displayOptions();
  const visiblePlanets = system.planets.filter(p => !p.hidden);
  const visibleBelts = system.belts.filter(b => !b.hidden);
  const visibleStations = opts.stations ? (system.stations || []).filter(s => !s.hidden) : [];
  const gateAU = system.stargateAU || stargateDistanceAU(system);
  const maxOrbit = Math.max(system.habitableZoneAU.outer * 1.15, ...visiblePlanets.map(p => p.orbitAU), ...visibleBelts.map(b => b.orbitAU), ...visibleStations.map(s => s.orbitAU), opts.stargate ? gateAU : 0, 1);
  const expansion = detectDenseInnerCluster(visiblePlanets, visibleBelts, gateAU);
  const width = systemProjectionWidth(maxOrbit, visiblePlanets.length + visibleBelts.length + visibleStations.length + (opts.stargate ? 1 : 0), expansion);
  const height = 460, left = 150, right = 130, centerY = 360;
  const scale = (width - left - right) / maxOrbit;
  const xForAU = au => expandedSystemX(au, maxOrbit, left, right, width, expansion);
  let svg = `<svg class="system-projection-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Linear star system projection" style="width:${width}px; min-width:${width}px;">`;
  svg += `<rect x="0" y="0" width="${width}" height="${height}" fill="#090b11"/>`;
  svg += `<text x="18" y="24" class="svg-label">Linear orbit projection</text>`;
  svg += `<text x="18" y="44" class="svg-muted">AU bar uses true AU labels. All planets are shown above the AU axis; crowded regions may be locally expanded for readability.</text>`;
  if (expansion?.enabled) {
    svg += `<text x="18" y="64" class="svg-muted">Expanded scale active: 0–${expansion.expandUntilAU} AU is visibly bracketed and stretched horizontally to prevent clustered bodies overlapping.</text>`;
  }
  svg += `<line x1="${left}" y1="${centerY}" x2="${width-right}" y2="${centerY}" stroke="#3a4254" stroke-width="2"/>`;
  const hzX1 = xForAU(system.habitableZoneAU.inner), hzX2 = xForAU(system.habitableZoneAU.outer);
  const hzBandY = centerY - 30;
  const hzBandH = 60;
  svg += `<rect x="${hzX1}" y="${hzBandY}" width="${Math.max(2, hzX2-hzX1)}" height="${hzBandH}" fill="#2e7d55" opacity=".24"/>`;
  svg += `<line x1="${hzX1}" y1="${hzBandY-10}" x2="${hzX1}" y2="${hzBandY+hzBandH+10}" stroke="#69c78f" stroke-width="1.5" stroke-dasharray="4 4"/>`;
  svg += `<line x1="${hzX2}" y1="${hzBandY-10}" x2="${hzX2}" y2="${hzBandY+hzBandH+10}" stroke="#69c78f" stroke-width="1.5" stroke-dasharray="4 4"/>`;
  svg += `<text x="${hzX1+5}" y="${hzBandY-10}" class="svg-muted">HZ ${system.habitableZoneAU.inner}–${system.habitableZoneAU.outer} AU</text>`;
  if (expansion?.enabled) {
    const expandX1 = xForAU(0);
    const expandX2 = xForAU(expansion.expandUntilAU);
    const bracketY = centerY + 58;
    svg += `<rect x="${expandX1}" y="${centerY-18}" width="${Math.max(2, expandX2-expandX1)}" height="36" fill="#89b4ff" opacity=".12"/>`;
    svg += `<line x1="${expandX1}" y1="${centerY-42}" x2="${expandX1}" y2="${centerY+42}" stroke="#89b4ff" stroke-width="2" stroke-dasharray="4 4"/>`;
    svg += `<line x1="${expandX2}" y1="${centerY-42}" x2="${expandX2}" y2="${centerY+42}" stroke="#89b4ff" stroke-width="2" stroke-dasharray="4 4"/>`;
    svg += `<line x1="${expandX1}" y1="${bracketY}" x2="${expandX2}" y2="${bracketY}" stroke="#89b4ff" stroke-width="3"/>`;
    svg += `<line x1="${expandX1}" y1="${bracketY-12}" x2="${expandX1}" y2="${bracketY+12}" stroke="#89b4ff" stroke-width="3"/>`;
    svg += `<line x1="${expandX2}" y1="${bracketY-12}" x2="${expandX2}" y2="${bracketY+12}" stroke="#89b4ff" stroke-width="3"/>`;
    svg += `<text x="${expandX1+10}" y="${bracketY+28}" class="svg-label">expanded AU scale: 0–${expansion.expandUntilAU} AU</text>`;
    svg += `<text x="${expandX1+10}" y="${bracketY+44}" class="svg-muted">This segment is stretched horizontally for readability; AU labels remain the true distances.</text>`;
  }

  const frostX = xForAU(system.frostLineAU);
  if (frostX < width - right + 20) {
    svg += `<line x1="${frostX}" y1="${centerY-54}" x2="${frostX}" y2="${centerY+54}" stroke="#85d7ff" stroke-width="1.5" stroke-dasharray="6 4"/>`;
    svg += `<text x="${frostX+5}" y="${centerY+70}" class="svg-muted">frost ${system.frostLineAU} AU</text>`;
  }
  expandedTickValues(maxOrbit, expansion).forEach(au => {
    const x = xForAU(au);
    const major = Math.abs(au - Math.round(au)) < 0.0001;
    svg += `<line x1="${x}" y1="${centerY-(major ? 10 : 6)}" x2="${x}" y2="${centerY+(major ? 10 : 6)}" stroke="#546075"/>`;
    svg += `<text x="${x-10}" y="${centerY+32}" class="svg-muted">${Number(au.toFixed(2))}</text>`;
  });
  svg += `<text x="${width-right-20}" y="${centerY+44}" class="svg-muted">AU</text>`;
  const starBaseX = left;
  if (system.stars.length === 1) {
    const star = system.stars[0];
    const r = clamp(24 + Math.sqrt(Math.max(star.radiusSolar, 0.01)) * 34, 20, 100);
    svg += `<circle cx="${starBaseX}" cy="${centerY}" r="${r}" fill="${bodyFill(star.type)}" stroke="#fff8" stroke-width="2">${svgTitle(starTooltip(star))}</circle>`;
    svg += `<text x="${starBaseX-38}" y="${centerY-r-14}" class="svg-label">${escSvg(star.label)} · ${star.radiusSolar}× Sol radius</text>`;
  } else {
    const sep = clamp(system.binary.separationAU * scale, 18, 70);
    system.stars.forEach((star, i) => {
      const r = clamp(22 + Math.sqrt(Math.max(star.radiusSolar, 0.01)) * 30, 18, 92);
      const y = centerY + (i === 0 ? -sep/2 : sep/2);
      svg += `<circle cx="${starBaseX}" cy="${y}" r="${r}" fill="${bodyFill(star.type)}" stroke="#fff8" stroke-width="2">${svgTitle(starTooltip(star))}</circle>`;
      svg += `<text x="${starBaseX+r+10}" y="${y+4}" class="svg-muted">${escSvg(star.role)}: ${escSvg(star.label)} · ${star.radiusSolar}× Sol radius</text>`;
    });
    svg += `<ellipse cx="${starBaseX}" cy="${centerY}" rx="${Math.max(22, sep/1.25)}" ry="${Math.max(22, sep)}" fill="none" stroke="#596071" stroke-dasharray="3 3"/>`;
  }
  visibleBelts.forEach(b => {
    const x = xForAU(b.orbitAU);
    svg += `<rect x="${x-4}" y="100" width="8" height="${height-200}" fill="#aaa" opacity=".28">${svgTitle(beltTooltip(b))}</rect>`;
    svg += `<text x="${x+6}" y="252" class="svg-muted">${escSvg(b.type)} ${b.orbitAU} AU</text>`;
  });
  if (opts.stargate) {
    const gateX = xForAU(gateAU);
    svg += `<line x1="${gateX}" y1="48" x2="${gateX}" y2="${height-48}" stroke="#b38cff" stroke-width="2" stroke-dasharray="8 5"/>`;
    svg += `<circle cx="${gateX}" cy="${centerY}" r="28" fill="none" stroke="#b38cff" stroke-width="4">${svgTitle(stargateTooltip(system))}</circle>`;
    svg += `<circle cx="${gateX}" cy="${centerY}" r="10" fill="#b38cff" opacity=".75">${svgTitle(stargateTooltip(system))}</circle>`;
    svg += `<text x="${gateX+10}" y="70" class="svg-label">Stargate ${gateAU} AU</text>`;
    svg += `<text x="${gateX+10}" y="88" class="svg-muted">max(50×√M, outer edge)</text>`;
  }

  const projectedPlanets = assignProjectionRows(visiblePlanets, xForAU, expansion?.enabled ? 190 : 130);
  projectedPlanets.forEach(({ item: p, x, row }, i) => {
    const r = visibleSystemRadius(p);
    const y = centerY + row;
    const labelX = expansion?.enabled ? x - r - 12 : x - r - 6;
    const nameY = Math.max(78, y - r - 28);
    const orbitY = Math.max(96, y - r - 10);

    svg += `<line x1="${x}" y1="${centerY}" x2="${x}" y2="${y}" stroke="#3a4254" stroke-width="1"/>`;
    svg += `<circle class="system-planet-hover-target" cx="${x}" cy="${y}" r="${Math.max(r + 24, 64)}" fill="transparent">${svgTitle(planetTooltip(p, system))}</circle>`;

    if (opts.zones) {
      const zoneR = clamp(r * 2.05, 38, 88);
      svg += `<circle cx="${x}" cy="${y}" r="${zoneR}" fill="none" stroke="#89b4ff" stroke-width="1.5" stroke-dasharray="5 4" opacity=".7">${svgTitle(`${p.name} sovereign volume\nRadius: ${ZONE_OF_CONTROL_KM.toLocaleString()} km\nApprox: ${ZONE_OF_CONTROL_AU.toFixed(6)} AU`)}</circle>`;
    }

    if (p.rings) svg += `<ellipse cx="${x}" cy="${y}" rx="${r*1.75}" ry="${r*.55}" fill="none" stroke="#cfc7a0" stroke-width="2" opacity=".8">${svgTitle(planetTooltip(p, system))}</ellipse>`;
    svg += `<circle cx="${x}" cy="${y}" r="${r}" fill="${bodyFill(p.type)}" stroke="#ffffff77" stroke-width="1.5">${svgTitle(planetTooltip(p, system))}</circle>`;

    // Label block above each body. Name and AU are stacked to avoid crossing the AU bar.
    svg += `<text x="${labelX}" y="${nameY}" class="svg-label">${escSvg(p.name)}</text>`;
    svg += `<text x="${labelX}" y="${orbitY}" class="svg-muted">${p.orbitAU} AU</text>`;
  });
    const y = centerY + row;
    const labelY = row < 0 ? y - r - 10 : y + r + 18;
    const orbitLabelY = row < 0 ? y + r + 16 : y - r - 10;

    svg += `<line x1="${x}" y1="${centerY}" x2="${x}" y2="${y}" stroke="#3a4254" stroke-width="1"/>`;
    svg += `<circle class="system-planet-hover-target" cx="${x}" cy="${y}" r="${Math.max(r + 24, 64)}" fill="transparent">${svgTitle(planetTooltip(p, system))}</circle>`;

    if (opts.zones) {
      const zoneR = clamp(r * 2.25, 42, 125);
      svg += `<circle cx="${x}" cy="${y}" r="${zoneR}" fill="none" stroke="#89b4ff" stroke-width="1.5" stroke-dasharray="5 4" opacity=".7">${svgTitle(`${p.name} sovereign volume\nRadius: ${ZONE_OF_CONTROL_KM.toLocaleString()} km\nApprox: ${ZONE_OF_CONTROL_AU.toFixed(6)} AU`)}</circle>`;
    }

    if (p.rings) svg += `<ellipse cx="${x}" cy="${y}" rx="${r*1.75}" ry="${r*.55}" fill="none" stroke="#cfc7a0" stroke-width="2" opacity=".8">${svgTitle(planetTooltip(p, system))}</ellipse>`;
    svg += `<circle cx="${x}" cy="${y}" r="${r}" fill="${bodyFill(p.type)}" stroke="#ffffff55" stroke-width="1.5">${svgTitle(planetTooltip(p, system))}</circle>`;
    const labelX = expansion?.enabled ? x - r - 10 : x - r;
    svg += `<text x="${labelX}" y="${labelY}" class="svg-label">${escSvg(p.name)}</text>`;
    svg += `<text x="${labelX}" y="${orbitLabelY}" class="svg-muted">${p.orbitAU} AU</text>`;
  });
  if (visibleStations.length) {
    const projectedStations = assignProjectionRows(visibleStations.map(s => ({ ...s, orbitAU: s.orbitAU })), xForAU, expansion?.enabled ? 160 : 120);
    projectedStations.forEach(({ item: s, x, row }, i) => {
      const y = Math.max(70, centerY + row - 28);
      const labelX = x + 12;
      svg += `<g class="tooltip-body" ${tooltipAttrs(stationTooltip(s))}>`;
      svg += `<rect x="${x-8}" y="${y-8}" width="16" height="16" fill="#c7b7ff" stroke="#ffffff77" stroke-width="1.5" transform="rotate(45 ${x} ${y})"/>`;
      svg += `<circle cx="${x}" cy="${y}" r="18" fill="transparent" pointer-events="all"/>`;
      svg += `</g>`;
      svg += `<line x1="${x}" y1="${centerY}" x2="${x}" y2="${y}" stroke="#c7b7ff" stroke-width="1" stroke-dasharray="3 4" opacity=".7"/>`;
      svg += `<text x="${labelX}" y="${y-10}" class="svg-label">${escSvg(s.name)}</text>`;
      svg += `<text x="${labelX}" y="${y+8}" class="svg-muted">${escSvg(s.type)}</text>`;
    });
  }

  svg += `</svg>`;
  return svg;
}
function planetSummaryHtml(p) {
  return `
    <div><strong>Type:</strong> ${escSvg(p.type)}</div>
    <div><strong>Orbit:</strong> ${p.orbitAU} AU</div>
    <div><strong>Year:</strong> ${p.yearEarthYears} Earth years</div>
    <div><strong>Temperature:</strong> ${p.avgTempK} K / ${p.avgTempC} °C</div>
    <div><strong>Gravity:</strong> ${p.surfaceGravityG} g</div>
    <div><strong>Atmosphere:</strong> ${escSvg(p.atmosphere)}</div>
    <div><strong>Rings:</strong> ${p.rings ? "yes" : "no"}</div>
    <div><strong>Life:</strong> ${escSvg(p.supportsLife)}</div>
    <div><strong>Habitability:</strong> ${p.habitabilityScore}/100</div>
  `;
}

function renderMoonItem(m, planetIndex, moonIndex) {
  const moon = document.createElement('div');
  moon.className = `moon-item${m.hidden ? ' hidden-item' : ''}`;
  moon.innerHTML = `
    <div><strong>${escSvg(m.name)}</strong> — ${escSvg(m.sizeClass)}; ${m.orbitalPeriodDays} days; ${escSvg(m.composition)}; life potential: ${escSvg(m.lifePotential)}</div>
    <div class="context-actions sub"></div>
  `;
  const actions = moon.querySelector('.context-actions');
  actions.appendChild(makeSmallButton(`${m.hidden ? 'Show' : 'Hide'} moon`, () => {
    lastSystem.planets[planetIndex].moons[moonIndex].hidden = !lastSystem.planets[planetIndex].moons[moonIndex].hidden;
    render();
  }));
  actions.appendChild(makeSmallButton('Regenerate moon', () => {
    const rng = systemRng(`moon-${planetIndex}-${moonIndex}`);
    const planet = lastSystem.planets[planetIndex];
    const newMoon = moonStats(rng, planet, 1)[0];
    newMoon.name = m.name;
    newMoon.hidden = m.hidden;
    planet.moons[moonIndex] = newMoon;
    render();
  }));
  return moon;
}

function renderSinglePlanetSvg(p) {
  const moons = p.moons.filter(m => !m.hidden);
  const width = 2600, height = 460, cx = 150, cy = 235;
  const planetR = p.type.includes('giant') ? clamp(28 + p.radiusEarth * 3, 42, 75) : clamp(20 + p.radiusEarth * 10, 22, 46);
  const maxMoonOrbit = Math.max(...moons.map(m => m.orbitalPeriodDays), 1);
  let svg = `<div class="planet-card"><div class="planet-card-title">${escSvg(p.name)} — top-down moon projection</div>`;
  svg += `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Top-down planet and moon projection for ${escSvg(p.name)}">`;
  svg += `<rect x="0" y="0" width="${width}" height="${height}" fill="#090b11"/>`;
  svg += `<text x="18" y="26" class="svg-label">${escSvg(p.name)}</text>`;
  svg += `<text x="18" y="46" class="svg-muted">Planet and moon diameters are enlarged independently. Moon orbit spacing uses generated orbital period.</text>`;
  if (p.rings) svg += `<ellipse cx="${cx}" cy="${cy}" rx="${planetR*1.75}" ry="${planetR*.55}" fill="none" stroke="#cfc7a0" stroke-width="3" opacity=".85"/>`;
  svg += `<circle cx="${cx}" cy="${cy}" r="${planetR}" fill="${bodyFill(p.type)}" stroke="#ffffff55" stroke-width="1.5"/>`;
  svg += `<text x="${cx-planetR}" y="${cy+planetR+34}" class="svg-muted">${escSvg(p.type)}, ${p.radiusEarth} R⊕</text>`;
  moons.forEach((m, i) => {
    const orbit = 250 + (m.orbitalPeriodDays / maxMoonOrbit) * 1800;
    const x = cx + orbit;
    const moonR = m.sizeClass.includes('large') ? 11 : m.sizeClass.includes('medium') ? 8 : m.sizeClass.includes('small') ? 6 : 4;
    svg += `<line x1="${cx+planetR}" y1="${cy}" x2="${x}" y2="${cy}" stroke="#2e3547" stroke-width="1"/>`;
    svg += `<circle cx="${x}" cy="${cy}" r="${moonR}" fill="${bodyFill(m.composition)}" stroke="#ffffff55" stroke-width="1"/>`;
    svg += `<text x="${x-20}" y="${cy-18-(i%3)*16}" class="svg-muted">${escSvg(m.name)}</text>`;
  });
  if (!moons.length) svg += `<text x="245" y="${cy+4}" class="svg-muted">No visible moons/satellites</text>`;
  svg += `</svg></div>`;
  return svg;
}


function plainPlanetDescription(p, system = null) {
  const hz = system && isInHabitableZone(p, system) ? " Within habitable zone." : "";
  return `${p.name}: ${p.type}, orbit ${p.orbitAU} AU.${hz}
Radius: ${p.radiusEarth}× Earth
Circumference: ${planetCircumferenceKm(p.radiusEarth).toLocaleString()} km
Gravity: ${p.surfaceGravityG} g
Temperature: ${p.avgTempC} °C
Atmosphere: ${p.atmosphere}
Composition: ${p.composition}
Colonisation: ${system && isSuitableForColonisation(p, system) ? "suitable for colonisation" : "not suitable for straightforward colonisation"}
Outpost: ${system && isSuitableForOutpost(p, system) ? "suitable for economic outpost" : "not recommended unless strategically necessary"}
Life: ${p.supportsLife}`;
}

function plainMoonDescription(m) {
  return `${m.name}: ${m.sizeClass}
Estimated radius: ${moonRadiusKmFromSize(m.sizeClass).toLocaleString()} km
Estimated circumference: ${moonCircumferenceKm(m.sizeClass).toLocaleString()} km
Orbital period: ${m.orbitalPeriodDays} days
Composition: ${m.composition}
Atmosphere: ${m.atmosphere}
Life potential: ${m.lifePotential}`;
}

function renderPlanetSvgs(system) {
  const opts = displayOptions();
  const planets = system.planets.filter(p => !p.hidden);
  if (!planets.length) return 'No visible planets.';

  return planets.map(p => {
    const planetIndex = system.planets.indexOf(p);
    const moons = p.moons.filter(m => !m.hidden);
    const width = 2600, height = 460, cx = 150, cy = 235;
    const planetR = p.type.includes('giant') ? clamp(28 + p.radiusEarth * 3, 42, 75) : clamp(20 + p.radiusEarth * 10, 22, 46);
    const maxMoonOrbit = Math.max(...moons.map(m => m.orbitalPeriodDays), 1);

    let html = `<div class="planet-card">`;
    html += `<div class="planet-card-header">`;
    html += `<div class="planet-card-title" ${tooltipAttrs(planetTooltip(p, system))}>${escSvg(p.name)} — planet section</div>`;
    html += `<p class="planet-card-summary">${planetDescription(p, system)}</p>`;
    html += `<div class="planet-card-controls">`;
    html += `<button class="small" type="button" data-toggle-planet-section>Minimise planet section</button>`;
    html += `<button class="small" type="button" data-toggle-moons-section>${moons.length ? "Minimise moons" : "No visible moons"}</button>`;
    html += `<button class="small" type="button" data-regenerate-planet="${planetIndex}">Regenerate ${escSvg(p.name)}</button>`;
    html += `<button class="small" type="button" data-hide-planet="${planetIndex}">Hide ${escSvg(p.name)}</button>`;
    html += `</div>`;

    if (moons.length) {
      html += `<div class="moon-detail-list">`;
      moons.forEach(m => {
        const moonIndex = p.moons.indexOf(m);
        html += `<div class="moon-summary" ${tooltipAttrs(moonTooltip(m))}>`;
        html += `<div>${moonDescription(m)}</div>`;
        html += `<div class="planet-card-controls">`;
        html += `<button class="small" type="button" data-regenerate-moon data-planet-index="${planetIndex}" data-moon-index="${moonIndex}">Regenerate ${escSvg(m.name)}</button>`;
        html += `<button class="small" type="button" data-hide-moon data-planet-index="${planetIndex}" data-moon-index="${moonIndex}">Hide ${escSvg(m.name)}</button>`;
        html += `</div>`;
        html += `</div>`;
      });
      html += `</div>`;
    }

    html += `</div>`;
    html += `<div class="planet-card-body">`;

    let svg = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Top-down planet and moon projection for ${escSvg(p.name)}">`;
    svg += `<rect x="0" y="0" width="${width}" height="${height}" fill="#090b11"/>`;
    svg += `<text x="18" y="26" class="svg-label">${escSvg(p.name)}</text>`;
    svg += `<text x="18" y="46" class="svg-muted">Planet/moon sizes are enlarged. Sovereign volume is a 1,000,000 km radius marker, not to scale.</text>`;

    if (opts.zones) {
      const zoneR = clamp(planetR * 2.6, 70, 135);
      svg += `<circle ${tooltipAttrs(`${p.name} sovereign volume\nRadius: ${ZONE_OF_CONTROL_KM.toLocaleString()} km\nApprox: ${ZONE_OF_CONTROL_AU.toFixed(6)} AU`)} cx="${cx}" cy="${cy}" r="${zoneR}" fill="none" stroke="#89b4ff" stroke-width="2" stroke-dasharray="6 5" opacity=".75"/>`;
      svg += `<text x="${cx-zoneR}" y="${cy-zoneR-8}" class="svg-muted">1,000,000 km sovereign volume</text>`;
    }

    svg += `<g class="tooltip-body" ${tooltipAttrs(planetTooltip(p, system))}>`;
    svg += `<circle class="planet-hover-target" cx="${cx}" cy="${cy}" r="${Math.max(planetR + 22, 80)}" fill="transparent" pointer-events="all"/>`;
    if (p.rings) svg += `<ellipse cx="${cx}" cy="${cy}" rx="${planetR*1.75}" ry="${planetR*.55}" fill="none" stroke="#cfc7a0" stroke-width="3" opacity=".85"/>`;
    svg += `<circle cx="${cx}" cy="${cy}" r="${planetR}" fill="${bodyFill(p.type)}" stroke="#ffffff55" stroke-width="1.5"/>`;
    svg += `</g>`;

    svg += `<text x="${cx-planetR}" y="${cy+planetR+34}" class="svg-muted">${escSvg(p.type)}, radius ${p.radiusEarth}× Earth, circumference ${planetCircumferenceKm(p.radiusEarth).toLocaleString()} km</text>`;

    moons.forEach((m, i) => {
      const orbit = 250 + (m.orbitalPeriodDays / maxMoonOrbit) * 1800;
      const x = cx + orbit;
      const moonR = m.sizeClass.includes('large') ? 11 : m.sizeClass.includes('medium') ? 8 : m.sizeClass.includes('small') ? 6 : 4;
      const laneOffset = [-54, 0, 54, -92, 92][i % 5];
      const moonY = cy + laneOffset;
      svg += `<g class="moon-visual tooltip-body" ${tooltipAttrs(moonTooltip(m))}>`;
      svg += `<line x1="${cx+planetR}" y1="${cy}" x2="${x}" y2="${moonY}" stroke="#2e3547" stroke-width="1"/>`;
      svg += `<circle class="moon-hover-target" cx="${x}" cy="${moonY}" r="${Math.max(24, moonR + 12)}" fill="transparent" pointer-events="all"/>`;
      svg += `<circle cx="${x}" cy="${moonY}" r="${moonR}" fill="${bodyFill(m.composition)}" stroke="#ffffff77" stroke-width="1"/>`;
      svg += `</g>`;
      const moonLabelY = Math.max(32, moonY - moonR - 18);
      svg += `<text class="moon-label" x="${x-28}" y="${moonLabelY}" class="svg-muted">${escSvg(m.name)}</text>`;
      svg += `<text class="moon-label" x="${x-28}" y="${moonLabelY+16}" class="svg-muted">${moonCircumferenceKm(m.sizeClass).toLocaleString()} km circ.</text>`;
    });

    if (!moons.length) svg += `<text x="245" y="${cy+4}" class="svg-muted">No visible moons/satellites</text>`;
    svg += `</svg>`;

    html += svg;
    html += `</div></div>`;
    return html;
  }).join('');
}

initCustomTooltips();

initProjectionSectionControls();