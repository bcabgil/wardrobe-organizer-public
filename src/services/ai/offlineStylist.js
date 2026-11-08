/**
 * offlineStylist.js - 100% Offline Rule-Based Fashion Stylist Engine
 * Generates cohesive 2-3 outfit recommendations based on:
 * - Clean status (strictly excludes 'to_wash')
 * - Active Season (includes activeSeason + 'all-season')
 * - Temperature Suitability ('freezing', 'cold', 'mild', 'warm', 'all-temps')
 * - Multi-Layering Role ('base' tee/shirt + 'mid' jumper/sweater/cardigan + 'outer' coat in cold/winter)
 * - Occasion ('everyday', 'gym', 'dress-up')
 * - Anchor Garment pinning (guaranteed inclusion in 100% of outfits)
 */

import { garmentMatchesOccasion } from '../../db/wardrobeDb.js';

const NEUTRAL_KEYWORDS = ['white', 'black', 'grey', 'gray', 'navy', 'beige', 'cream', 'camel', 'charcoal', 'khaki', 'denim', 'indigo', 'brown', 'tan', 'ivory'];

export function isSportsBra(garment = {}) {
  const text = `${garment.name || ''} ${garment.visualDescription || ''}`.toLowerCase();
  return /bra|bralette|sujetador|crop\s*top|support\s*top|sports\s*top|underlayer|bustier/i.test(text);
}

export function inferLayerRole(garment = {}) {
  if (garment.layerRole && ['base', 'mid', 'outer', 'single'].includes(garment.layerRole)) {
    return garment.layerRole;
  }
  const cat = String(garment.category || 'top').toLowerCase();
  if (cat === 'outerwear') return 'outer';
  if (cat !== 'top') return 'single';

  const text = `${garment.name || ''} ${garment.visualDescription || ''}`.toLowerCase();
  if (/jumper|sweater|cardigan|hoodie|pullover|knit|fleece|sweatshirt|vest|turtleneck|quarter-zip/i.test(text)) {
    return 'mid';
  }
  return 'base';
}

const VALID_TEMP_BANDS = ['freezing', 'cold', 'mild', 'warm', 'all-temps'];

export function inferTempSuitabilityList(garment = {}) {
  const raw = garment?.tempSuitability;
  if (Array.isArray(raw)) {
    const valid = raw.filter((v) => VALID_TEMP_BANDS.includes(v));
    if (valid.length > 0) return valid;
  } else if (typeof raw === 'string' && raw.trim()) {
    const parts = raw
      .split(',')
      .map((s) => s.trim())
      .filter((v) => VALID_TEMP_BANDS.includes(v));
    if (parts.length > 0) return parts;
  }

  if (garment?.season === 'all-season') return ['all-temps'];
  if (garment?.season === 'winter') return ['cold'];
  if (garment?.season === 'summer') return ['warm'];
  return ['all-temps'];
}

export function inferTempSuitability(garment = {}) {
  const list = inferTempSuitabilityList(garment);
  return list.length === 1 ? list[0] : list;
}

export function isGarmentTempCompatible(garment, targetTempBand, role) {
  const suitList = inferTempSuitabilityList(garment);
  if (suitList.includes('all-temps') || !targetTempBand) return true;

  // Base layers (t-shirts, shirts) can be worn under jumpers even in cold/freezing weather
  if (role === 'base' && (targetTempBand === 'cold' || targetTempBand === 'freezing')) {
    return true;
  }

  // If the garment uses explicit multi-select array of temperature bands, match selected bands directly
  if (Array.isArray(garment?.tempSuitability) && garment.tempSuitability.length > 0) {
    return suitList.includes(targetTempBand);
  }

  return suitList.some((suit) => {
    if (targetTempBand === 'warm') {
      // In hot weather, avoid freezing/cold garments
      return suit === 'warm' || suit === 'mild';
    }
    if (targetTempBand === 'freezing') {
      return suit === 'freezing' || suit === 'cold' || suit === 'mild';
    }
    if (targetTempBand === 'cold') {
      return suit === 'cold' || suit === 'freezing' || suit === 'mild';
    }
    // mild
    return suit !== 'freezing';
  });
}

function getTargetTempBand(weatherData, activeSeason) {
  if (weatherData && typeof weatherData === 'object') {
    const tempMax = typeof weatherData.tempMax === 'number' ? weatherData.tempMax : null;
    const tempMin = typeof weatherData.tempMin === 'number' ? weatherData.tempMin : null;
    if ((tempMax !== null && tempMax <= 5) || (tempMin !== null && tempMin <= 0)) return 'freezing';
    if ((tempMax !== null && tempMax <= 16) || (tempMin !== null && tempMin <= 10)) return 'cold';
    if ((tempMax !== null && tempMax >= 25) || (tempMin !== null && tempMin >= 20)) return 'warm';
    return 'mild';
  }
  return activeSeason === 'winter' ? 'cold' : 'warm';
}

function hasNeutralTone(garment) {
  const text = `${garment.name || ''} ${garment.visualDescription || ''}`.toLowerCase();
  if (garment.colorGroup === 'whites') return true;
  return NEUTRAL_KEYWORDS.some((kw) => text.includes(kw));
}

function getFitSilhouette(garment) {
  const text = `${garment?.name || ''} ${garment?.visualDescription || ''}`.toLowerCase();
  if (/oversized|relaxed|boxy|chunky|slouchy|wide|loose/i.test(text)) return 'relaxed';
  if (/slim|tailored|fitted|skinny|structured|tapered|cropped/i.test(text)) return 'fitted';
  return 'regular';
}

function scorePairHarmony(itemA, itemB, occasion, targetTempBand) {
  let score = 50;
  if (!itemA || !itemB) return score;

  if (itemA.type === occasion) score += 20;
  if (itemB.type === occasion) score += 20;

  if (itemA.colorGroup !== itemB.colorGroup) {
    score += 15;
  } else if (hasNeutralTone(itemA) || hasNeutralTone(itemB)) {
    score += 12;
  }

  // Temperature match bonus
  const suitA = inferTempSuitabilityList(itemA);
  const suitB = inferTempSuitabilityList(itemB);
  if (suitA.includes(targetTempBand)) score += 12;
  if (suitB.includes(targetTempBand)) score += 12;

  // Fit & body proportion balance bonus (from Fit Video / visualDescription)
  const fitA = getFitSilhouette(itemA);
  const fitB = getFitSilhouette(itemB);
  if ((fitA === 'relaxed' && fitB === 'fitted') || (fitA === 'fitted' && fitB === 'relaxed')) {
    score += 10;
  }

  return score;
}

function evaluateLayeringNeeds(weatherData, activeSeason) {
  const tempBand = getTargetTempBand(weatherData, activeSeason);

  if (weatherData && typeof weatherData === 'object') {
    const tempMax = typeof weatherData.tempMax === 'number' ? weatherData.tempMax : null;
    const tempMin = typeof weatherData.tempMin === 'number' ? weatherData.tempMin : null;
    const rainProb = typeof weatherData.rainProb === 'number' ? weatherData.rainProb : 0;
    const cond = String(weatherData.condition || '').toLowerCase();

    if ((tempMax !== null && tempMax >= 25) || (tempMin !== null && tempMin >= 21) || /hot|heat|scorching/i.test(cond)) {
      return {
        tempBand: 'warm',
        needMidLayer: false,
        needOuterwear: false,
        forbidOuterwear: true,
        forbidMidLayer: true
      };
    }

    const isChillyOrCold =
      (tempMax !== null && tempMax <= 16) ||
      (tempMin !== null && tempMin <= 11) ||
      /cold|chilly|freezing|snow|frost/i.test(cond) ||
      activeSeason === 'winter';

    const isWetOrCold =
      isChillyOrCold ||
      rainProb >= 50 ||
      /rain|shower|storm|wind/i.test(cond);

    return {
      tempBand,
      needMidLayer: isChillyOrCold,
      needOuterwear: isWetOrCold,
      forbidOuterwear: false,
      forbidMidLayer: false
    };
  }

  if (activeSeason === 'winter') {
    return {
      tempBand: 'cold',
      needMidLayer: true,
      needOuterwear: true,
      forbidOuterwear: false,
      forbidMidLayer: false
    };
  }

  return {
    tempBand: 'warm',
    needMidLayer: false,
    needOuterwear: false,
    forbidOuterwear: false,
    forbidMidLayer: false
  };
}

export function inspectGarmentFeatures(garment = {}) {
  const rawName = String(garment?.name || '');
  const rawDesc = String(garment?.visualDescription || '');
  const combinedRaw = `${rawName} ${rawDesc}`.toLowerCase();

  // Strip negated clauses (e.g. "without buttons", "no buttons", "no collar", "without sleeves")
  // so positive keyword checks never false-match negated descriptions.
  const sanitized = combinedRaw.replace(
    /\b(without|no|zero|lacks|free\s+of|not)\s+(any\s+|a\s+)?(buttons?|buttoned|buttoning|collar|collared|sleeves?|zip(per)?s?|hood|pockets?)\b/gi,
    ' '
  );
  const nameLower = rawName.toLowerCase();

  const isQuarterZip = /quarter[- ]?zip|half[- ]?zip|1\/4[- ]?zip|zip[- ]?neck|zip[- ]?collar/i.test(sanitized);
  const isFullZip =
    !isQuarterZip &&
    /full[- ]?zip|zip[- ]?up|zip[- ]?front|zipped\s+hoodie|zip\s+jacket|zip\s+cardigan/i.test(sanitized);

  const isPulloverOrSweatshirt =
    /\b(pullover|sweatshirt|jumper|sweater|hoodie|turtleneck|crew[- ]?neck|v[- ]?neck|tee|t[- ]?shirt|tank|camisole|top)\b/i.test(
      nameLower
    ) && !/\b(cardigan|shirt|blouse|polo|henley|blazer|coat|jacket|waistcoat)\b/i.test(nameLower);

  const hasExplicitButtons =
    !/buttonless|unbuttoned\s+pullover/i.test(combinedRaw) &&
    !isQuarterZip &&
    !isFullZip &&
    (/\b(cardigan|button[- ]?down|button[- ]?up|button[- ]?front|oxford\s+shirt|dress\s+shirt|poplin\s+shirt|henley|waistcoat)\b/i.test(
      sanitized
    ) ||
      (!isPulloverOrSweatshirt && /\b(buttoned|buttons|shirt|blazer|trench)\b/i.test(sanitized)));

  let closureType = 'pullover';
  if (isQuarterZip) {
    closureType = 'quarter-zip';
  } else if (isFullZip) {
    closureType = 'full-zip';
  } else if (hasExplicitButtons) {
    closureType = 'buttoned';
  } else if (/open[- ]?front/i.test(sanitized)) {
    closureType = 'open-front';
  }

  // Sleeve length detection
  let sleeveType = 'regular';
  if (
    /sleeveless|\btank\b|camisole|\bcami\b|halter|spaghetti\s+strap|strapless|tube\s+top|\bvest\b|gilet/i.test(
      combinedRaw
    )
  ) {
    sleeveType = 'sleeveless';
  } else if (/cap[- ]?sleeve/i.test(combinedRaw)) {
    sleeveType = 'cap-sleeve';
  } else if (
    !/long[- ]?sleeve/i.test(sanitized) &&
    (/short[- ]?sleeve|\btee\b|t[- ]?shirt|\bpolo\b|baby\s+tee/i.test(nameLower) ||
      /short[- ]?sleeve/i.test(sanitized))
  ) {
    sleeveType = 'short-sleeve';
  } else if (/3\/4[- ]?sleeve|three[- ]?quarter\s+sleeve|elbow[- ]?sleeve/i.test(sanitized)) {
    sleeveType = 'three-quarter';
  } else if (
    /long[- ]?sleeve|jumper|sweater|pullover|cardigan|sweatshirt|hoodie|turtleneck|blazer|coat|jacket|oxford|button[- ]?down|flannel|dress\s+shirt|poplin\s+shirt/i.test(
      sanitized
    )
  ) {
    sleeveType = 'long-sleeve';
  }

  // Neckline detection
  let necklineType = 'crewneck';
  if (/turtleneck|roll[- ]?neck|polo[- ]?neck|funnel[- ]?neck/i.test(sanitized)) {
    necklineType = 'turtleneck';
  } else if (/high[- ]?neck|mock[- ]?neck|stand[- ]?collar/i.test(sanitized)) {
    necklineType = 'high-neck';
  } else if (isQuarterZip) {
    necklineType = 'quarter-zip';
  } else if (
    !/collarless/i.test(combinedRaw) &&
    /\b(collared|collar|button[- ]?down|oxford|dress\s+shirt|poplin\s+shirt|polo|lapel)\b/i.test(sanitized)
  ) {
    necklineType = 'collared';
  } else if (/\bv[- ]?neck\b/i.test(sanitized)) {
    necklineType = 'v-neck';
  } else if (/\bhoodie\b|\bhooded\b/i.test(sanitized)) {
    necklineType = 'hooded';
  } else if (/scoop[- ]?neck|boat[- ]?neck|square[- ]?neck|sweetheart|off[- ]?shoulder/i.test(sanitized)) {
    necklineType = 'scoop-neck';
  }

  const isCropped = /\bcrop(ped)?\b|waist[- ]?length|boxy\s+crop/i.test(sanitized);
  const hasRibbedHem = /ribbed|knit|jumper|sweater|pullover|sweatshirt|hoodie|cardigan/i.test(sanitized);
  const isWideLeg = /wide[- ]?leg|palazzo|flared|culotte|baggy|loose[- ]?fit\s+trouser/i.test(sanitized);
  const isPleatedOrTailored = /pleat(ed)?|pintuck|tailored|suitt?|trouser|slacks|chino|dress\s+pant/i.test(sanitized);
  const isSkirt = /\bskirt\b|midi|mini|maxi/i.test(sanitized);
  const isShorts = /\bshorts?\b/i.test(sanitized);
  const isDenim = /\bjeans?\b|\bdenim\b/i.test(sanitized);

  return {
    closureType,
    sleeveType,
    necklineType,
    isCropped,
    hasRibbedHem,
    isWideLeg,
    isPleatedOrTailored,
    isSkirt,
    isShorts,
    isDenim,
    silhouette: getFitSilhouette(garment)
  };
}

function pickVariant(options = [], seed = 0) {
  if (!Array.isArray(options) || options.length === 0) return '';
  const idx = Math.abs(Number(seed) || 0) % options.length;
  return options[idx];
}

function computeOutfitSeed(garmentsInOutfit = [], outfitIndex = 0) {
  const idStr = garmentsInOutfit.map((g) => `${g?.id || ''}:${g?.name || ''}`).join('|');
  let hash = Number(outfitIndex) * 31;
  for (let i = 0; i < idStr.length; i++) {
    hash = (hash * 33 + idStr.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function buildLayeringTip(weatherData, activeSeason, hasMidLayer, hasOuterwear, garmentsInOutfit, outfitIndex = 0) {
  const basePiece = garmentsInOutfit.find((g) => g.category === 'top' && inferLayerRole(g) === 'base');
  const midPiece = garmentsInOutfit.find((g) => g.category === 'top' && inferLayerRole(g) === 'mid');
  const anyTop = garmentsInOutfit.find((g) => g.category === 'top');
  const bottomPiece = garmentsInOutfit.find((g) => g.category === 'bottom');
  const outerPiece = garmentsInOutfit.find((g) => g.category === 'outerwear');
  const onePiece = garmentsInOutfit.find((g) => g.category === 'one-piece');
  const shoePiece = garmentsInOutfit.find((g) => g.category === 'shoes');

  const bottomName = bottomPiece ? bottomPiece.name : 'bottoms';
  const bottomFeat = inspectGarmentFeatures(bottomPiece || {});
  const seed = computeOutfitSeed(garmentsInOutfit, outfitIndex);
  const tips = [];

  // Gym combination (sports bra + sports tee + trousers)
  const braPiece = garmentsInOutfit.find((g) => g.category === 'top' && isSportsBra(g));
  const gymTeePiece = garmentsInOutfit.find((g) => g.category === 'top' && !isSportsBra(g));
  if (braPiece && gymTeePiece) {
    return pickVariant(
      [
        `Do a side-tuck or slight cropped fold on your ${gymTeePiece.name} so the high waistband of your ${bottomName} defines the waist while the ${braPiece.name} frames the neckline.`,
        `Wear the ${gymTeePiece.name} loose over your ${braPiece.name} with a quick front-knot or side gather at the hip to keep the ${bottomName} line streamlined during movement.`,
        `Layer your ${gymTeePiece.name} cleanly over the ${braPiece.name} and tuck just the front edge into the waistband of your ${bottomName} for a balanced athletic silhouette.`
      ],
      seed
    );
  }

  const bottomDrapeClause = bottomFeat.isWideLeg
    ? `let your ${bottomName} drape full-length over ${shoePiece ? `your ${shoePiece.name}` : 'your footwear'} to elongate the leg line`
    : bottomFeat.isPleatedOrTailored
      ? `keep the pleated waistband of your ${bottomName} visible and unobstructed to lengthen your vertical proportions`
      : bottomFeat.isDenim
        ? `let the hem of your ${bottomName} sit cleanly at the ankle${shoePiece ? ` over your ${shoePiece.name}` : ''}`
        : `create a clean, uninterrupted waist-to-hem line with your ${bottomName}`;

  if (hasMidLayer && basePiece && midPiece) {
    const baseFeat = inspectGarmentFeatures(basePiece);
    const midFeat = inspectGarmentFeatures(midPiece);
    const baseHasLongSleeves = baseFeat.sleeveType === 'long-sleeve';
    const baseHasHighOrCollaredNeck =
      baseFeat.necklineType === 'collared' ||
      baseFeat.necklineType === 'high-neck' ||
      baseFeat.necklineType === 'turtleneck';

    if (midFeat.closureType === 'quarter-zip') {
      // Quarter-zip / half-zip mid layer (NEVER suggest buttons!)
      const neckDetail =
        baseFeat.necklineType === 'high-neck' || baseFeat.necklineType === 'turtleneck'
          ? `unzip the collar of your ${midPiece.name} halfway so the high neckline of your ${basePiece.name} frames the V-opening`
          : baseFeat.necklineType === 'collared'
            ? `unzip your ${midPiece.name} a third of the way down so the collar of your ${basePiece.name} sits neatly inside the zip opening`
            : `leave the quarter-zip collar of your ${midPiece.name} partially unzipped to show a clean triangle of your ${basePiece.name} at the collarbone`;

      const hemDetail = midFeat.isCropped
        ? `let the cropped hem of the ${midPiece.name} hit right at the waistband of your ${bottomName}`
        : `fold the ribbed hem of your ${midPiece.name} slightly under at the hipbone so ${bottomDrapeClause}`;

      tips.push(
        pickVariant(
          [
            `Tuck your ${basePiece.name} smoothly into your ${bottomName}, ${neckDetail}, and ${hemDetail}.`,
            `Keep your ${basePiece.name} tucked flat inside your ${bottomName} for a bulk-free waist, ${neckDetail}, and push the sleeves of your ${midPiece.name} slightly up the forearm while ${hemDetail}.`
          ],
          seed
        )
      );
    } else if (midFeat.closureType === 'buttoned') {
      // Genuinely buttoned mid-layer (e.g. cardigan, waistcoat, buttoned overshirt)
      tips.push(
        pickVariant(
          [
            `Tuck your ${basePiece.name} fully into your ${bottomName}, fasten only the middle buttons of your ${midPiece.name} while leaving the bottom button undone at the waist, and ${bottomDrapeClause}.`,
            `Wear your ${basePiece.name} neatly tucked into the waistband of your ${bottomName} and leave your ${midPiece.name} unbuttoned (or fastened with just a single center button) to create a long vertical frame.`,
            `Tuck the ${basePiece.name} into your ${bottomName} to define the waist, button the top half of your ${midPiece.name} so it parts slightly over the waistband, and push the cardigan sleeves just above the wrist.`
          ],
          seed
        )
      );
    } else if (midFeat.closureType === 'full-zip' || midFeat.closureType === 'open-front') {
      tips.push(
        pickVariant(
          [
            `Tuck your ${basePiece.name} cleanly into your ${bottomName} to anchor the waist, and wear your ${midPiece.name} open at the front so the high waistband stays visible.`,
            `Smooth your ${basePiece.name} inside your ${bottomName}, leave your ${midPiece.name} unzipped through the torso for vertical lines, and ${bottomDrapeClause}.`
          ],
          seed
        )
      );
    } else if (midFeat.necklineType === 'turtleneck') {
      // Turtleneck pullover mid-layer: covers the neck completely; base tee is a smooth under-layer (no collar peek; no cuff peek unless base is long-sleeve)
      const cuffNote = baseHasLongSleeves
        ? `letting a sliver of the ${basePiece.name} cuffs show at the wrist`
        : `pushing the sleeves of your ${midPiece.name} slightly up the forearm to reveal the wrists`;

      const hemNote = midFeat.isCropped
        ? `let the cropped hem of your ${midPiece.name} rest cleanly at the top of your ${bottomName}`
        : `fold the ribbed hem of your ${midPiece.name} inward at the hip (or do a light front-tuck into the waistband)`;

      tips.push(
        pickVariant(
          [
            `Tuck your ${basePiece.name} flat into your ${bottomName} so it stays completely smooth and invisible underneath, ${hemNote}, and ${bottomDrapeClause}.`,
            `Wear the ${basePiece.name} tucked smoothly inside your ${bottomName} as a sleek base layer, then style your ${midPiece.name} by ${cuffNote} and ${hemNote} to highlight the waist.`,
            `Keep your ${basePiece.name} tucked neatly into your ${bottomName} to prevent bunching at the waist, let the turtleneck of your ${midPiece.name} frame the face cleanly, and ${hemNote}.`
          ],
          seed
        )
      );
    } else {
      // Standard pullover / jumper / sweater / sweatshirt / hoodie (NO buttons!)
      if (baseFeat.necklineType === 'collared' && baseHasLongSleeves) {
        // Long-sleeve collared shirt under a pullover
        tips.push(
          pickVariant(
            [
              `Tuck your ${basePiece.name} into your ${bottomName}, let its collar points and 1 cm of the shirt cuffs peek out from your ${midPiece.name}, and ${midFeat.isCropped ? `let the cropped hem sit at the waist` : `fold the jumper hem neatly at the hip`}.`,
              `Wear your ${basePiece.name} tucked smoothly into your ${bottomName} with the collar nested inside the neckline of your ${midPiece.name}, turn back the shirt cuffs once over the jumper sleeves, and ${bottomDrapeClause}.`
            ],
            seed
          )
        );
      } else if (baseHasHighOrCollaredNeck && !baseHasLongSleeves) {
        // High-neck or collared short-sleeve/cap-sleeve top under a crewneck/V-neck pullover (NO wrist cuffs to peek out!)
        const hemAction = midFeat.isCropped
          ? `let the cropped cut of your ${midPiece.name} meet the waistband of your ${bottomName}`
          : `do a light front-tuck or fold the ribbed hem of your ${midPiece.name} under at the waist`;

        tips.push(
          pickVariant(
            [
              `Tuck your ${basePiece.name} smoothly into your ${bottomName}, let its neckline frame the collar of your ${midPiece.name}, and ${hemAction} while pushing the jumper sleeves slightly up the forearm.`,
              `Keep the ${basePiece.name} tucked flat inside your ${bottomName} so the waist stays sleek, let a clean rim of its neckline show at the top of your ${midPiece.name}, and ${bottomDrapeClause}.`
            ],
            seed
          )
        );
      } else if (baseHasLongSleeves) {
        // Long-sleeve crew/basic base under a pullover
        const hemAction = midFeat.isCropped
          ? `let the cropped hem of your ${midPiece.name} hit right at the waistband`
          : `fold the ribbed hem of your ${midPiece.name} under at the hipbone`;

        tips.push(
          pickVariant(
            [
              `Tuck your ${basePiece.name} into your ${bottomName} for a smooth foundation, let a subtle edge of the long-sleeve cuffs show at the wrist of your ${midPiece.name}, and ${hemAction}.`,
              `Wear the ${basePiece.name} tucked flat inside your ${bottomName}, push the sleeves of both layers slightly up the forearm, and ${hemAction} so ${bottomDrapeClause}.`
            ],
            seed
          )
        );
      } else {
        // Short-sleeve / cap-sleeve / sleeveless tee under a crewneck/V-neck/hooded pullover (NO wrist cuffs, and no collar above turtleneck!)
        const neckNote =
          midFeat.necklineType === 'v-neck'
            ? `let the neckline of your ${basePiece.name} sit cleanly inside the V-neck of your ${midPiece.name}`
            : `let a subtle edge of the ${basePiece.name} crew neckline show at the collar of your ${midPiece.name}`;

        const hemAction = midFeat.isCropped
          ? `let the cropped hem of your ${midPiece.name} sit right at the waistband of your ${bottomName}`
          : midFeat.silhouette === 'relaxed'
            ? `fold the ribbed hem of your ${midPiece.name} inward at the hip (or do a relaxed French front-tuck) to balance its volume`
            : `lightly French-tuck the front of your ${midPiece.name} into the waistband of your ${bottomName}`;

        tips.push(
          pickVariant(
            [
              `Tuck your ${basePiece.name} flat into your ${bottomName} so it stays smooth underneath, ${neckNote}, and ${hemAction} to elongate your leg line.`,
              `Wear the ${basePiece.name} neatly tucked into your ${bottomName} as a smooth base layer, push the sleeves of your ${midPiece.name} slightly up the forearm to open up the silhouette, and ${hemAction}.`,
              `Keep your ${basePiece.name} tucked inside your ${bottomName} to define the waist, ${hemAction}, and ${bottomDrapeClause}.`
            ],
            seed
          )
        );
      }
    }
  } else if (anyTop) {
    const topFeat = inspectGarmentFeatures(anyTop);

    if (topFeat.closureType === 'buttoned') {
      const sleeveAction =
        topFeat.sleeveType === 'long-sleeve'
          ? `and roll the sleeves twice just below the elbow`
          : `and ${bottomDrapeClause}`;
      tips.push(
        pickVariant(
          [
            `Undo the top button of your ${anyTop.name}, style it with a crisp French front-tuck into your ${bottomName}, ${sleeveAction} for an effortless silhouette.`,
            `Tuck your ${anyTop.name} fully into your ${bottomName}, leave the collar button undone to lengthen the neckline, ${sleeveAction}.`
          ],
          seed
        )
      );
    } else if (topFeat.closureType === 'quarter-zip') {
      tips.push(
        pickVariant(
          [
            `Unzip the collar of your ${anyTop.name} partway to create a flattering V-neckline, ${topFeat.isCropped ? `let its cropped hem sit cleanly at the waistband of your ${bottomName}` : `fold its hem neatly at the waist of your ${bottomName}`}, and ${bottomDrapeClause}.`,
            `Style your ${anyTop.name} with the quarter-zip slightly open at the collarbone and push the sleeves up the forearm to balance the proportions of your ${bottomName}.`
          ],
          seed
        )
      );
    } else if (topFeat.isCropped) {
      tips.push(
        pickVariant(
          [
            `Let the cropped hem of your ${anyTop.name} meet the top of your ${bottomName} waistband without tucking to highlight your natural waist, and ${bottomDrapeClause}.`,
            `Pair the cropped length of your ${anyTop.name} directly with the waistline of your ${bottomName} for a clean 1:2 top-to-leg proportion.`
          ],
          seed
        )
      );
    } else if (topFeat.sleeveType === 'long-sleeve') {
      tips.push(
        pickVariant(
          [
            `Do a clean front French-tuck with your ${anyTop.name} into the waistband of your ${bottomName} and push the sleeves slightly up the forearm to sharpen the proportions.`,
            `Fold the hem of your ${anyTop.name} neatly at the waist of your ${bottomName} (or tuck the front center in) and ${bottomDrapeClause}.`
          ],
          seed
        )
      );
    } else {
      // Short-sleeve, cap-sleeve, or sleeveless top
      tips.push(
        pickVariant(
          [
            `Tuck your ${anyTop.name} fully into your ${bottomName} so the waistband sits flat and clean, and ${bottomDrapeClause}.`,
            `Style your ${anyTop.name} with a relaxed French front-tuck into the waistband of your ${bottomName} to highlight your waist while letting ${bottomDrapeClause}.`
          ],
          seed
        )
      );
    }
  } else if (onePiece) {
    tips.push(
      pickVariant(
        [
          `Cinch or define the waist of your ${onePiece.name} and keep the neckline and wrists uncluttered to elongate the vertical silhouette.`,
          `Let your ${onePiece.name} fall in a clean unbroken column${shoePiece ? ` down to your ${shoePiece.name}` : ''} for a polished, elongated profile.`
        ],
        seed
      )
    );
  }

  if (hasOuterwear && outerPiece) {
    const outerFeat = inspectGarmentFeatures(outerPiece);
    const outerLower = `${outerPiece.name || ''} ${outerPiece.visualDescription || ''}`.toLowerCase();
    const isBlazerOrCoat = /blazer|coat|trench|tailored/i.test(outerLower);
    if (isBlazerOrCoat && outerFeat.closureType === 'buttoned') {
      tips.push(
        `Wear your ${outerPiece.name} open (or fasten only the single middle button) to create clean vertical lines that frame the waist underneath.`
      );
    } else {
      tips.push(
        `Wear your ${outerPiece.name} open at the front to showcase the layered waist definition underneath.`
      );
    }
  }

  return tips.join(' ');
}

export function buildCombinationKey(garmentIds = []) {
  return Array.from(new Set((garmentIds || []).filter(Boolean)))
    .sort()
    .join('|');
}

export function sortOutfitsByWearPreference(outfits = [], wearCounts = {}) {
  if (!Array.isArray(outfits)) return [];
  const counts = wearCounts && typeof wearCounts === 'object' ? wearCounts : {};
  return outfits
    .map((outfit, originalIndex) => {
      const key = outfit.combinationKey || buildCombinationKey(outfit.garmentIds || []);
      const wornCount =
        typeof counts[key] === 'number'
          ? counts[key]
          : typeof outfit.wornCount === 'number'
            ? outfit.wornCount
            : 0;
      return {
        ...outfit,
        combinationKey: key,
        wornCount,
        _origIdx: originalIndex
      };
    })
    .sort((a, b) => {
      if (b.wornCount !== a.wornCount) {
        return b.wornCount - a.wornCount;
      }
      return a._origIdx - b._origIdx;
    })
    .map(({ _origIdx, ...rest }) => rest);
}

/**
 * Generate 1-3 rule-based outfits synchronously (100% offline capable)
 * Supports multi-layering (Base Tee/Shirt + Mid Jumper/Sweater + Outer Coat), temperature suitability,
 * and user wear-frequency preference ordering.
 */
export function generateOfflineOutfits({
  garments = [],
  occasion = 'everyday',
  activeSeason = 'winter',
  anchorGarmentId = null,
  weatherData = null,
  wearCounts = {},
  includeOuterwear = true,
  shuffle = false
} = {}) {
  if (!Array.isArray(garments) || garments.length === 0) {
    return {
      engine: 'offline',
      outfits: [],
      message: 'Your wardrobe is currently empty. Add garments in the + tab to get outfit recommendations!'
    };
  }

  // 1. Strictly filter to CLEAN garments only
  const cleanGarments = garments.filter((g) => g && g.status === 'clean');
  if (cleanGarments.length === 0) {
    return {
      engine: 'offline',
      outfits: [],
      message: 'All garments are currently marked "To Wash". Complete a laundry load to unlock clean outfit suggestions!'
    };
  }

  // 2. Evaluate weather & layering needs
  const layeringEval = evaluateLayeringNeeds(weatherData, activeSeason);
  const { tempBand, needMidLayer, forbidMidLayer } = layeringEval;
  const needOuterwear = includeOuterwear ? layeringEval.needOuterwear : false;
  const forbidOuterwear = includeOuterwear ? layeringEval.forbidOuterwear : true;

  // 3. Filter by Occasion Wardrobe (strict independence: everyday, gym, dress-up), Active Season, and Temperature Compatibility
  // Note: Gym clothes (sports bra, sports T-shirt, gym trousers) are worn year-round for workouts regardless of outdoor season/temp.
  const inSeasonGarments = cleanGarments.filter((g) => {
    if (!garmentMatchesOccasion(g, occasion)) return false;
    if (occasion === 'gym') return true;
    const seasonOk = !g.season || g.season === activeSeason || g.season === 'all-season';
    if (!seasonOk) return false;
    const role = inferLayerRole(g);
    return isGarmentTempCompatible(g, tempBand, role);
  });

  // Locate anchor piece if requested (must be clean and belong to the same occasion wardrobe)
  const anchorItem = anchorGarmentId
    ? cleanGarments.find((g) => g.id === anchorGarmentId && garmentMatchesOccasion(g, occasion)) || null
    : null;

  const filterByCategory = (cat) => {
    return inSeasonGarments.filter((g) => g.category === cat);
  };

  const allTops = filterByCategory('top');
  // Partition tops into base layers (t-shirts, shirts) and mid layers (jumpers, sweaters, hoodies, cardigans)
  const baseTops = allTops.filter((g) => inferLayerRole(g) === 'base');
  const midTops = allTops.filter((g) => inferLayerRole(g) === 'mid');

  // For Gym: partition tops into Sports Bras (under-layer) and Sports T-shirts/Tops (over-layer)
  const sportsBras = occasion === 'gym' ? allTops.filter((g) => isSportsBra(g)) : [];
  const gymTshirts = occasion === 'gym' ? allTops.filter((g) => !isSportsBra(g)) : [];

  const bottoms = filterByCategory('bottom');
  const onePieces = filterByCategory('one-piece');
  const outerwearList = includeOuterwear ? filterByCategory('outerwear') : [];
  const shoesList = filterByCategory('shoes');
  const accessories = filterByCategory('accessory');

  const candidateCombinations = [];

  const addCombo = (items, baseScore, styleLabel) => {
    const uniqueItems = [];
    const seenIds = new Set();

    if (anchorItem) {
      uniqueItems.push(anchorItem);
      seenIds.add(anchorItem.id);
    }

    for (const it of items) {
      if (!it || seenIds.has(it.id)) continue;
      if (forbidOuterwear && it.category === 'outerwear' && (!anchorItem || anchorItem.id !== it.id)) {
        continue;
      }
      if (
        occasion !== 'gym' &&
        forbidMidLayer &&
        it.category === 'top' &&
        inferLayerRole(it) === 'mid' &&
        (!anchorItem || anchorItem.id !== it.id)
      ) {
        continue;
      }

      // If anchorItem is a non-top category (e.g. bottom, shoes, outerwear, one-piece), don't add a second item of the same category
      if (
        anchorItem &&
        it.category === anchorItem.category &&
        ['bottom', 'one-piece', 'shoes', 'outerwear'].includes(it.category)
      ) {
        continue;
      }

      // For tops:
      // - In Gym: allow 2 tops (Sports Bra + Sports T-shirt)
      // - In Everyday/Dress-up: allow 1 'base' top + 1 'mid' top in layered outfits
      if (it.category === 'top') {
        const currentTopCount = uniqueItems.filter((u) => u.category === 'top').length;
        if (currentTopCount >= 2) continue;

        if (occasion !== 'gym') {
          const itRole = inferLayerRole(it);
          const alreadyHasSameRoleTop = uniqueItems.some(
            (u) => u.category === 'top' && inferLayerRole(u) === itRole
          );
          if (alreadyHasSameRoleTop) {
            if (!(needMidLayer && midTops.length === 0 && currentTopCount < 2)) {
              continue;
            }
          }
        }
      }

      uniqueItems.push(it);
      seenIds.add(it.id);
    }

    if (uniqueItems.length < 2) return;

    const key = buildCombinationKey(uniqueItems.map((g) => g.id));
    if (candidateCombinations.some((c) => c.key === key)) return;

    const wornCount = wearCounts && typeof wearCounts[key] === 'number' ? wearCounts[key] : 0;

    candidateCombinations.push({
      key,
      items: uniqueItems,
      wornCount,
      score: baseScore + wornCount * 25,
      styleLabel
    });
  };

  // Strategy A: One-piece outfits
  const effectiveOnePieces =
    anchorItem && anchorItem.category === 'one-piece' ? [anchorItem] : onePieces;

  for (const dress of effectiveOnePieces) {
    const midLayer = !forbidMidLayer && needMidLayer && midTops.length > 0 ? midTops[0] : null;
    const shoe = shoesList[0] || null;
    const coat = !forbidOuterwear && needOuterwear && outerwearList.length > 0 ? outerwearList[0] : null;
    const acc = accessories[0] || null;
    const comboItems = [dress, midLayer, coat, shoe, acc].filter(Boolean);
    const score = 115 + (dress.type === occasion ? 35 : 0);
    addCombo(comboItems, score, 'Refined Silhouette');
  }

  // Strategy B: Top(s) + Bottom combinations
  const candidateBottoms = anchorItem && anchorItem.category === 'bottom' ? [anchorItem] : bottoms;

  if (occasion === 'gym') {
    // GYM LAYERING: Top (Sports Bra + Sports T-shirt) + Bottom Trousers
    if (sportsBras.length > 0 && gymTshirts.length > 0 && candidateBottoms.length > 0) {
      for (let braIdx = 0; braIdx < sportsBras.length; braIdx++) {
        const bra = sportsBras[braIdx];
        for (let shirtIdx = 0; shirtIdx < gymTshirts.length; shirtIdx++) {
          const shirt = gymTshirts[shirtIdx];
          for (let bIdx = 0; bIdx < candidateBottoms.length; bIdx++) {
            const bottom = candidateBottoms[bIdx];
            const score =
              scorePairHarmony(bra, shirt, occasion, tempBand) +
              scorePairHarmony(shirt, bottom, occasion, tempBand);
            const shoe =
              shoesList.length > 0 ? shoesList[(braIdx + shirtIdx + bIdx) % shoesList.length] : null;
            const coat =
              !forbidOuterwear && outerwearList.length > 0
                ? outerwearList[(braIdx + shirtIdx + bIdx) % outerwearList.length]
                : null;
            const acc =
              accessories.length > 0 && (braIdx + shirtIdx) % 2 === 0 ? accessories[0] : null;
            addCombo([bra, shirt, bottom, coat, shoe, acc].filter(Boolean), score + 25, 'Active Training Set');
          }
        }
      }
    } else if (allTops.length >= 2 && candidateBottoms.length > 0) {
      // Fallback if 2+ gym tops exist without explicit "bra" keyword: pair 2 gym tops + bottom trousers
      for (let i = 0; i < allTops.length; i++) {
        for (let j = i + 1; j < allTops.length; j++) {
          const topA = allTops[i];
          const topB = allTops[j];
          for (let bIdx = 0; bIdx < candidateBottoms.length; bIdx++) {
            const bottom = candidateBottoms[bIdx];
            const score =
              scorePairHarmony(topA, topB, occasion, tempBand) +
              scorePairHarmony(topB, bottom, occasion, tempBand);
            const shoe = shoesList.length > 0 ? shoesList[(i + j + bIdx) % shoesList.length] : null;
            const coat =
              !forbidOuterwear && outerwearList.length > 0
                ? outerwearList[(i + j + bIdx) % outerwearList.length]
                : null;
            addCombo([topA, topB, bottom, coat, shoe].filter(Boolean), score + 20, 'Active Training Set');
          }
        }
      }
    } else if (allTops.length >= 1 && candidateBottoms.length > 0) {
      // Single gym top + bottom trousers
      for (let tIdx = 0; tIdx < allTops.length; tIdx++) {
        const top = allTops[tIdx];
        for (let bIdx = 0; bIdx < candidateBottoms.length; bIdx++) {
          const bottom = candidateBottoms[bIdx];
          const score = scorePairHarmony(top, bottom, occasion, tempBand);
          const shoe = shoesList.length > 0 ? shoesList[(tIdx + bIdx) % shoesList.length] : null;
          const coat =
            !forbidOuterwear && outerwearList.length > 0
              ? outerwearList[(tIdx + bIdx) % outerwearList.length]
              : null;
          addCombo([top, bottom, coat, shoe].filter(Boolean), score, 'Active Training Set');
        }
      }
    }

    // If Gym still has 0 combinations but has >= 2 clean gym pieces, build an overall Gym combination
    if (candidateCombinations.length === 0 && inSeasonGarments.length >= 2) {
      addCombo(inSeasonGarments.slice(0, 4), 100, 'Complete Gym Kit');
    }
  } else {
    // EVERYDAY & DRESS-UP LAYERING: Base Tee/Shirt + Mid Jumper/Sweater + Bottom
    const primaryTops =
      anchorItem && anchorItem.category === 'top'
        ? [anchorItem]
        : baseTops.length > 0
          ? baseTops
          : allTops;

    for (let tIdx = 0; tIdx < primaryTops.length; tIdx++) {
      const primaryTop = primaryTops[tIdx];
      const primaryRole = inferLayerRole(primaryTop);

      for (let bIdx = 0; bIdx < candidateBottoms.length; bIdx++) {
        const bottom = candidateBottoms[bIdx];
        let score = scorePairHarmony(primaryTop, bottom, occasion, tempBand);

        // Build complimentary second top layer pool (e.g. Base Tee + Mid Jumper in winter/cold)
        let secondLayerPool = [null];
        if (needMidLayer && !forbidMidLayer) {
          if (primaryRole === 'base' && midTops.length > 0) {
            secondLayerPool = midTops;
          } else if (primaryRole === 'mid' && baseTops.length > 0) {
            secondLayerPool = baseTops;
          }
        }

        for (let mIdx = 0; mIdx < secondLayerPool.length; mIdx++) {
          const secondTopLayer = secondLayerPool[(tIdx + bIdx + mIdx) % secondLayerPool.length];
          const comboScore = score + (secondTopLayer ? 18 : 0);

          const shoe = shoesList.length > 0 ? shoesList[(tIdx + bIdx + mIdx) % shoesList.length] : null;
          let coat = null;
          if (!forbidOuterwear && outerwearList.length > 0) {
            if (needOuterwear || tIdx === 0) {
              coat = outerwearList[(tIdx + bIdx + mIdx) % outerwearList.length];
            }
          }

          const acc = accessories.length > 0 && (tIdx + mIdx) % 2 === 0 ? accessories[0] : null;
          // Order base layer before mid layer
          const orderedTops =
            secondTopLayer && primaryRole === 'mid'
              ? [secondTopLayer, primaryTop]
              : [primaryTop, secondTopLayer].filter(Boolean);

          const items = [...orderedTops, bottom, coat, shoe, acc].filter(Boolean);
          const label =
            occasion === 'dress-up'
              ? 'Elevated Evening Edit'
              : secondTopLayer || coat
                ? `Layered ${activeSeason.charAt(0).toUpperCase() + activeSeason.slice(1)} Look`
                : 'Smart Everyday Essentials';

          addCombo(items, comboScore + (coat && needOuterwear ? 15 : 0), label);
        }
      }
    }
  }

  if (shuffle && candidateCombinations.length > 1) {
    // Fisher-Yates shuffle to surface fresh/different combinations on Refresh Ideas
    for (let i = candidateCombinations.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = candidateCombinations[i];
      candidateCombinations[i] = candidateCombinations[j];
      candidateCombinations[j] = tmp;
    }
  } else {
    candidateCombinations.sort((a, b) => b.score - a.score);
  }
  const topOutfits = candidateCombinations.slice(0, 10);

  if (topOutfits.length === 0) {
    return {
      engine: 'offline',
      outfits: [],
      message: `Not enough matching clean ${activeSeason} garments (e.g. both a top and a bottom) to build a complete ${occasion} outfit.`
    };
  }

  const TITLES_BY_OCCASION = {
    everyday: [
      'Effortless Daily Edit',
      'Modern Casual Balance',
      'Polished Street Layering',
      'Relaxed Urban Silhouette',
      'Crisp Everyday Standard',
      'Weekend Comfort Edit',
      'Clean Minimalist Pairing',
      'Smart Off-Duty Combo',
      'Versatile City Layer',
      'Classic Wardrobe Staple'
    ],
    gym: [
      'High-Output Training Kit',
      'Breathable Athletic Flow',
      'Dynamic Workout Set',
      'Core Performance Layer',
      'Endurance Gym Combo',
      'Active Studio Ensemble',
      'Cardio & Strength Kit',
      'Flexible Training Pair',
      'Lightweight Athletic Edit',
      'All-Session Gym Outfit'
    ],
    'dress-up': [
      'Tailored Evening Statement',
      'Refined Formal Ensemble',
      'Sleek Occasion Look',
      'Polished Dinner Edit',
      'Elevated Night Silhouette',
      'Classic Dress-Up Balance',
      'Sophisticated Event Pairing',
      'Sharp Tailored Lineup',
      'Luxe Occasion Edit',
      'Modern Formal Harmony'
    ]
  };

  const titles = TITLES_BY_OCCASION[occasion] || TITLES_BY_OCCASION.everyday;

  const formattedOutfits = topOutfits.map((combo, idx) => {
    const names = combo.items.map((g) => g.name);
    const hasCoat = combo.items.some((g) => g.category === 'outerwear');
    const topItems = combo.items.filter((g) => g.category === 'top');
    const hasMidLayer = topItems.length >= 2 || topItems.some((g) => inferLayerRole(g) === 'mid');
    const title = titles[idx] || `${combo.styleLabel} #${idx + 1}`;

    const weatherClause =
      weatherData && weatherData.condition
        ? ` Tailored for tomorrow's forecast (${weatherData.condition}, ${weatherData.tempMin ?? ''}°C–${weatherData.tempMax ?? ''}°C).`
        : '';

    const anchorClause = anchorItem
      ? ` Built directly around your pinned ${anchorItem.name}.`
      : '';

    const layerClause =
      topItems.length >= 2
        ? ` Features smart thermal multi-layering (${topItems.map((t) => t.name).join(' under/over ')}) for ${tempBand} conditions.`
        : '';

    const explanation = `Combines ${names.join(' + ')} for a cohesive ${activeSeason} ${occasion} look with balanced color harmony and clean proportions.${layerClause}${anchorClause}${weatherClause}`;

    const layeringTips = buildLayeringTip(weatherData, activeSeason, hasMidLayer, hasCoat, combo.items, idx);

    return {
      id: `offline_outfit_${idx + 1}_${Date.now()}`,
      title,
      garmentIds: combo.items.map((g) => g.id),
      combinationKey: combo.key,
      wornCount: combo.wornCount || 0,
      explanation,
      layeringTips,
      occasion,
      season: activeSeason,
      tempBand
    };
  });

  const sortedOutfits = sortOutfitsByWearPreference(formattedOutfits, wearCounts);

  return {
    engine: 'offline',
    outfits: sortedOutfits,
    message: `Generated ${sortedOutfits.length} outfit recommendation(s) using the offline stylist.`
  };
}

export { buildLayeringTip };

export default {
  inferLayerRole,
  inferTempSuitability,
  isGarmentTempCompatible,
  inspectGarmentFeatures,
  buildLayeringTip,
  buildCombinationKey,
  sortOutfitsByWearPreference,
  generateOfflineOutfits
};
