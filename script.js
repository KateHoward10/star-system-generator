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
  if (score >= 70) {
    const complexChance = criteria.lifeBias === "optimistic" || criteria.lifeBias === "forced" ? 0.28 : 0.12;
    life = chance(rng, complexChance) ? "Complex multicellular life" : "Microbial life";
  } else if (score >= 52) {
    life = chance(rng, 0.55) ? "Microbial life" : "Prebiotic chemistry";
  } else if (score >= 40) {
    life = "Prebiotic chemistry";
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
  p.habitabilityScore = between(rng, 72, 91, 0);
  p.supportsLife = pick(rng, ["Microbial life", "Microbial life", "Complex multicellular life"]);
  planets.push(p);
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

  const planets = [];
  let start = Math.max(0.02, stellar.habitableZoneAU.inner * between(rng, 0.25, 0.7, 2));

  if (stellar.binary?.stableInnerAU) {
    start = Math.max(start, stellar.binary.stableInnerAU * between(rng, 1.05, 1.4, 2));
  }

  let distance = start;
  const forceGasIndex = criteria.requireGasGiant ? Math.max(1, Math.floor(criteria.planetCount * 0.65)) : -1;

  for (let i = 1; i <= criteria.planetCount; i++) {
    distance *= between(rng, 1.35, 2.05, 2);

    if (stellar.binary?.stableOuterAU && distance > stellar.binary.stableOuterAU) break;

    planets.push(generatePlanet(rng, i, stellar, criteria, distance, i === forceGasIndex));
  }

  if (criteria.requireLife || criteria.lifeBias === "forced") {
    forceLifeWorld(rng, planets, stellar, criteria);
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

  return {
    seed: seedText,
    realism: "Hard sci-fi; balanced physics with optimistic biology",
    ageLabel,
    ageGyr: criteria.ageGyr,
    metallicity: criteria.metallicity,
    richElement: criteria.richElement,
    ...stellar,
    stargateAU: gateDistanceAU,
    stargateFormula: "Actual Gate Distance (AU) = max(50 × √(Star Mass in Solar Masses), Outer Edge of Major Planetary/Debris Region + Safety Buffer)",
    stargateSafetyBufferAU: Number(Math.max(5, outerMajorRegionAU({ ...stellar, planets, belts }) * 0.15).toFixed(2)),
    zoneOfControlRadiusKm: ZONE_OF_CONTROL_KM,
    zoneOfControlRadiusAU: Number(ZONE_OF_CONTROL_AU.toFixed(6)),
    planets: planets.sort((a, b) => a.orbitAU - b.orbitAU),
    belts
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
  out += `ELEMENTAL BIAS: ${richElementLabel(system.richElement)}\n\n`;
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
Stargate safety buffer used: ${system.stargateSafetyBufferAU} AU
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
    out += `Habitability score: ${p.habitabilityScore}/100\n`;
    out += `Visible moons/satellites: ${p.moons.filter(m => !m.hidden).length}\n`;

    p.moons.filter(m => !m.hidden).forEach(m => {
      out += `  - ${m.name}: ${m.sizeClass}; estimated circumference ${moonCircumferenceKm(m.sizeClass).toLocaleString()} km; period ${m.orbitalPeriodDays} days; ${m.composition}; `;
      out += `tidal heating ${m.tidalHeating ? "yes" : "no"}; atmosphere ${m.atmosphere}; `;
      out += `subsurface ocean ${m.subsurfaceOcean ? "yes" : "no"}; life potential: ${m.lifePotential}\n`;
    });
  });

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
    systemAge: document.getElementById("systemAge").value,
    metallicity: document.getElementById("metallicity").value,
    richElement: document.getElementById("richElement").value,
    seed: document.getElementById("seed").value.trim(),
    requireLife: document.getElementById("requireLife").checked,
    requireBelt: document.getElementById("requireBelt").checked,
    requireGasGiant: document.getElementById("requireGasGiant").checked,
    allowTidallyLockedLife: document.getElementById("allowTidallyLockedLife").checked,
    showStargate: document.getElementById("showStargate")?.checked ?? true,
    showZonesOfControl: document.getElementById("showZonesOfControl")?.checked ?? true,
    showSolOverlay: document.getElementById("showSolOverlay")?.checked ?? false
  };
}

function render() {
  const output = document.getElementById("output");
  const actions = document.getElementById("actions");

  if (!lastSystem) {
    output.textContent = "Set criteria, then generate a system.";
    actions.innerHTML = "";
    renderVisuals();
    return;
  }

  output.textContent = formatSystem(lastSystem);
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


["showStargate", "showZonesOfControl", "showSolOverlay"].forEach(id => {
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

function svgTitle(text) {
  return `<title>${escSvg(text)}</title>`;
}

function starTooltip(star) {
  return `${star.role.toUpperCase()} STAR
Type: ${star.label}
Mass: ${star.massSolar} solar masses
Radius: ${star.radiusSolar} solar radii
Luminosity: ${star.luminositySolar} solar
Temperature: ${star.tempK} K
Activity: ${star.activity}
Habitability note: ${star.lifeStability}`;
}

function planetTooltip(p, system) {
  return `${p.name}
Type: ${p.type}
Orbit: ${p.orbitAU} AU
Year: ${p.yearEarthYears} Earth years
Average temperature: ${p.avgTempK} K / ${p.avgTempC} °C
Radius: ${p.radiusEarth}× Earth radius
Circumference: ${planetCircumferenceKm(p.radiusEarth).toLocaleString()} km
Mass/radius/gravity: ${p.massEarth} M⊕, ${p.radiusEarth} R⊕, ${p.surfaceGravityG} g
Atmosphere: ${p.atmosphere}
Composition: ${p.composition}
Life: ${p.supportsLife}
Habitability score: ${p.habitabilityScore}/100
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
Safety buffer used: ${system.stargateSafetyBufferAU} AU
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
  const safetyBuffer = Math.max(5, outerEdge * 0.15);
  return Number(Math.max(massTerm, outerEdge + safetyBuffer).toFixed(2));
}

function displayOptions() {
  return {
    stargate: document.getElementById("showStargate")?.checked ?? true,
    zones: document.getElementById("showZonesOfControl")?.checked ?? true,
    solOverlay: document.getElementById("showSolOverlay")?.checked ?? false
  };
}

function systemProjectionWidth(maxOrbit, bodyCount) {
  // Readable wide linear projection with horizontal scrolling.
  const pxPerAU = maxOrbit <= 5 ? 520 : maxOrbit <= 20 ? 260 : maxOrbit <= 80 ? 95 : 45;
  return Math.max(2600, 260 + maxOrbit * pxPerAU, bodyCount * 360);
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
    ? clamp(16 + p.radiusEarth * 1.5, 24, 48)
    : clamp(10 + p.radiusEarth * 6, 14, 28);
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
function renderSystemSvg(system) {
  const opts = displayOptions();
  const visiblePlanets = system.planets.filter(p => !p.hidden);
  const visibleBelts = system.belts.filter(b => !b.hidden);
  const gateAU = system.stargateAU || stargateDistanceAU(system);
  const maxOrbit = Math.max(system.habitableZoneAU.outer * 1.15, ...visiblePlanets.map(p => p.orbitAU), ...visibleBelts.map(b => b.orbitAU), opts.stargate ? gateAU : 0, 1);
  const width = systemProjectionWidth(maxOrbit, visiblePlanets.length + visibleBelts.length + (opts.stargate ? 1 : 0));
  const height = 460, left = 130, right = 110, centerY = 235;
  const scale = (width - left - right) / maxOrbit;
  const xForAU = au => left + au * scale;
  let svg = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Linear star system projection">`;
  svg += `<rect x="0" y="0" width="${width}" height="${height}" fill="#090b11"/>`;
  svg += `<text x="18" y="24" class="svg-label">Linear orbit projection</text>`;
  svg += `<text x="18" y="44" class="svg-muted">Planet positions use linear AU distance with horizontal scrolling. Star/body sizes are enlarged independently for readability.</text>`;
  svg += `<line x1="${left}" y1="${centerY}" x2="${width-right}" y2="${centerY}" stroke="#3a4254" stroke-width="2"/>`;
  const hzX1 = xForAU(system.habitableZoneAU.inner), hzX2 = xForAU(system.habitableZoneAU.outer);
  svg += `<rect x="${hzX1}" y="72" width="${Math.max(2, hzX2-hzX1)}" height="186" fill="#2e7d55" opacity=".22"/>`;
  svg += `<line x1="${hzX1}" y1="66" x2="${hzX1}" y2="266" stroke="#69c78f" stroke-width="1" stroke-dasharray="4 4"/>`;
  svg += `<line x1="${hzX2}" y1="66" x2="${hzX2}" y2="266" stroke="#69c78f" stroke-width="1" stroke-dasharray="4 4"/>`;
  svg += `<text x="${hzX1+5}" y="88" class="svg-muted">HZ ${system.habitableZoneAU.inner}–${system.habitableZoneAU.outer} AU</text>`;
  const frostX = xForAU(system.frostLineAU);
  if (frostX < width - right + 20) {
    svg += `<line x1="${frostX}" y1="58" x2="${frostX}" y2="276" stroke="#85d7ff" stroke-width="1" stroke-dasharray="6 4"/>`;
    svg += `<text x="${frostX+5}" y="278" class="svg-muted">frost ${system.frostLineAU} AU</text>`;
  }
  const tickStep = maxOrbit <= 1 ? 0.1 : maxOrbit <= 5 ? 0.5 : maxOrbit <= 15 ? 1 : 5;
  for (let au = 0; au <= maxOrbit + 0.0001; au += tickStep) {
    const x = xForAU(au);
    svg += `<line x1="${x}" y1="${centerY-7}" x2="${x}" y2="${centerY+7}" stroke="#546075"/>`;
    svg += `<text x="${x-8}" y="${centerY+34}" class="svg-muted">${Number(au.toFixed(1))}</text>`;
  }
  svg += `<text x="${width-right-20}" y="${centerY+58}" class="svg-muted">AU</text>`;
  const starBaseX = left;
  if (system.stars.length === 1) {
    const star = system.stars[0];
    const r = clamp(22 + Math.sqrt(Math.max(star.radiusSolar, 0.01)) * 34, 18, 115);
    if (opts.solOverlay) {
      const solR = clamp(22 + Math.sqrt(1) * 34, 18, 115);
      svg += `<circle cx="${starBaseX}" cy="${centerY}" r="${solR}" fill="none" stroke="#f4d35e" stroke-width="2" stroke-dasharray="6 4" opacity=".9">${svgTitle("Sol overlay\nRadius: 1 solar radius\nUsed for visual star-size comparison only.")}</circle>`;
      svg += `<text x="${starBaseX+solR+10}" y="${centerY-solR+14}" class="svg-muted">Sol overlay: 1 R☉</text>`;
    }
    svg += `<circle cx="${starBaseX}" cy="${centerY}" r="${r}" fill="${bodyFill(star.type)}" stroke="#fff8" stroke-width="2">${svgTitle(starTooltip(star))}</circle>`;
    svg += `<text x="${starBaseX-38}" y="${centerY-r-14}" class="svg-label">${escSvg(star.label)} · ${star.radiusSolar} R☉</text>`;
  } else {
    const sep = clamp(system.binary.separationAU * scale, 18, 70);
    if (opts.solOverlay) {
      const solR = clamp(22 + Math.sqrt(1) * 34, 18, 115);
      svg += `<circle cx="${starBaseX}" cy="${centerY}" r="${solR}" fill="none" stroke="#f4d35e" stroke-width="2" stroke-dasharray="6 4" opacity=".8">${svgTitle("Sol overlay\nRadius: 1 solar radius\nUsed for visual star-size comparison only.")}</circle>`;
      svg += `<text x="${starBaseX+solR+10}" y="${centerY-solR+14}" class="svg-muted">Sol overlay: 1 R☉</text>`;
    }
    system.stars.forEach((star, i) => {
      const r = clamp(18 + Math.sqrt(Math.max(star.radiusSolar, 0.01)) * 30, 14, 105);
      const y = centerY + (i === 0 ? -sep/2 : sep/2);
      svg += `<circle cx="${starBaseX}" cy="${y}" r="${r}" fill="${bodyFill(star.type)}" stroke="#fff8" stroke-width="2">${svgTitle(starTooltip(star))}</circle>`;
      svg += `<text x="${starBaseX+r+10}" y="${y+4}" class="svg-muted">${escSvg(star.role)}: ${escSvg(star.label)} · ${star.radiusSolar} R☉</text>`;
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
    svg += `<text x="${gateX+10}" y="88" class="svg-muted">max(50×√M, outer edge + buffer)</text>`;
  }

  visiblePlanets.forEach((p, i) => {
    const x = xForAU(p.orbitAU);
    const r = visibleSystemRadius(p);
    const y = centerY + (i % 2 === 0 ? -70 : 70);
    svg += `<line x1="${x}" y1="${centerY}" x2="${x}" y2="${y}" stroke="#3a4254" stroke-width="1"/>`;
    svg += `<circle class="system-planet-hover-target" cx="${x}" cy="${y}" r="${Math.max(r + 24, 64)}" fill="transparent">${svgTitle(planetTooltip(p, system))}</circle>`;
    if (opts.zones) {
      const zoneR = clamp(r * 2.25, 42, 125);
      svg += `<circle cx="${x}" cy="${y}" r="${zoneR}" fill="none" stroke="#89b4ff" stroke-width="1.5" stroke-dasharray="5 4" opacity=".7">${svgTitle(`${p.name} sovereign volume\nRadius: ${ZONE_OF_CONTROL_KM.toLocaleString()} km\nApprox: ${ZONE_OF_CONTROL_AU.toFixed(6)} AU`)}</circle>`;
    }
    if (p.rings) svg += `<ellipse cx="${x}" cy="${y}" rx="${r*1.75}" ry="${r*.55}" fill="none" stroke="#cfc7a0" stroke-width="2" opacity=".8">${svgTitle(planetTooltip(p, system))}</ellipse>`;
    svg += `<circle cx="${x}" cy="${y}" r="${r}" fill="${bodyFill(p.type)}" stroke="#ffffff55" stroke-width="1.5">${svgTitle(planetTooltip(p, system))}</circle>`;
    svg += `<text x="${x-r}" y="${y-r-8}" class="svg-label">${escSvg(p.name)}</text>`;
    svg += `<text x="${x-r}" y="${y+r+16}" class="svg-muted">${p.orbitAU} AU</text>`;
  });
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
  const width = 2400, height = 320, cx = 130, cy = 160;
  const planetR = p.type.includes('giant') ? clamp(28 + p.radiusEarth * 3, 42, 75) : clamp(20 + p.radiusEarth * 10, 22, 46);
  const maxMoonOrbit = Math.max(...moons.map(m => m.orbitalPeriodDays), 1);
  let svg = `<div class="planet-card"><div class="planet-card-title">${escSvg(p.name)} — top-down moon projection</div>`;
  svg += `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Top-down planet and moon projection for ${escSvg(p.name)}">`;
  svg += `<rect x="0" y="0" width="${width}" height="${height}" fill="#090b11"/>`;
  svg += `<text x="18" y="26" class="svg-label">${escSvg(p.name)}</text>`;
  svg += `<text x="18" y="46" class="svg-muted">Planet and moon diameters are enlarged independently. Moon orbit spacing uses generated orbital period.</text>`;
  if (p.rings) svg += `<ellipse cx="${cx}" cy="${cy}" rx="${planetR*1.75}" ry="${planetR*.55}" fill="none" stroke="#cfc7a0" stroke-width="3" opacity=".85"/>`;
  svg += `<circle cx="${cx}" cy="${cy}" r="${planetR}" fill="${bodyFill(p.type)}" stroke="#ffffff55" stroke-width="1.5"/>`;
  svg += `<text x="${cx-planetR}" y="${cy+planetR+18}" class="svg-muted">${escSvg(p.type)}, ${p.radiusEarth} R⊕</text>`;
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

function renderPlanetSvgs(system) {
  const target = document.createDocumentFragment();
  if (!system.planets.length) return 'No generated planets.';

  const wrapper = document.createElement('div');
  wrapper.style.display = 'grid';
  wrapper.style.gap = '14px';

  system.planets.forEach((p, planetIndex) => {
    const section = document.createElement('section');
    section.className = `planet-section${p.hidden ? ' hidden-item' : ''}`;
    section.innerHTML = `
      <div class="planet-section-header">
        <div>
          <h4 class="planet-section-title">${escSvg(p.name)}</h4>
          <div class="planet-section-meta">${p.hidden ? 'Hidden from generated text/system projection' : 'Visible'} · ${escSvg(p.type)} · ${p.orbitAU} AU</div>
        </div>
        <div class="context-actions"></div>
      </div>
      <div class="planet-image-context"></div>
      <div class="planet-data">${planetSummaryHtml(p)}</div>
      <div class="moon-list"></div>
    `;

    const actions = section.querySelector('.context-actions');
    actions.appendChild(makeSmallButton(`${p.hidden ? 'Show' : 'Hide'} planet`, () => {
      lastSystem.planets[planetIndex].hidden = !lastSystem.planets[planetIndex].hidden;
      render();
    }));
    actions.appendChild(makeSmallButton('Regenerate planet', () => {
      const rng = systemRng(`planet-${planetIndex}`);
      const replacement = generatePlanet(rng, planetIndex + 1, lastSystem, lastCriteria, p.orbitAU, false, p.name);
      replacement.hidden = p.hidden;
      lastSystem.planets[planetIndex] = replacement;
      render();
    }));

    section.querySelector('.planet-image-context').innerHTML = renderSinglePlanetSvg(p);

    const moonList = section.querySelector('.moon-list');
    if (!p.moons.length) {
      moonList.innerHTML = '<div class="moon-item">No generated moons/satellites.</div>';
    } else {
      p.moons.forEach((m, moonIndex) => moonList.appendChild(renderMoonItem(m, planetIndex, moonIndex)));
    }

    wrapper.appendChild(section);
  });

  target.appendChild(wrapper);
  return target;
}