/**
 * geminiService.js - Google Gemini 2.5 Flash Multimodal Vision & AI Fashion Stylist Service
 * Provides:
 * - AUTO_TAG_SCHEMA & analyzeGarmentPhoto(imageBlob, apiKey)
 * - suggestTomorrowOutfits({ garments, occasion, activeSeason, anchorGarmentId, weatherNote, weatherData, apiKey })
 * - Automatic resilience fallback to offlineStylist on missing API key or HTTP/network errors.
 */

import { optimizeImageForGemini, extractVideoKeyframes } from './imageOptimizer.js';
import { garmentMatchesOccasion, getGarmentOccasionList } from '../../db/wardrobeDb.js';
import {
  generateOfflineOutfits,
  inferLayerRole,
  inferTempSuitability,
  inferTempSuitabilityList,
  inspectGarmentFeatures,
  buildLayeringTip,
  buildCombinationKey,
  sortOutfitsByWearPreference
} from './offlineStylist.js';

export const STYLE_CACHE_VERSION = 'v4-style';

const OUTFIT_SUGGESTION_CACHE = new Map();

export function clearOutfitSuggestionCache() {
  OUTFIT_SUGGESTION_CACHE.clear();
}

export function computeOutfitCacheKey({
  garments = [],
  occasion = 'everyday',
  activeSeason = 'winter',
  anchorGarmentId = null,
  weatherNote = '',
  weatherData = null,
  hasApiKey = false,
  includeOuterwear = false,
  stylePreferences = ''
} = {}) {
  const cleanInSeasonSig = (garments || [])
    .filter(
      (g) =>
        g &&
        g.status === 'clean' &&
        garmentMatchesOccasion(g, occasion) &&
        (occasion === 'gym' || !g.season || g.season === activeSeason || g.season === 'all-season') &&
        (includeOuterwear || g.category !== 'outerwear' || g.id === anchorGarmentId)
    )
    .map(
      (g) =>
        `${g.id}:${g.category || ''}:${g.season || ''}:${Array.isArray(g.tempSuitability) ? g.tempSuitability.join('|') : g.tempSuitability || ''}:${g.layerRole || ''}:${getGarmentOccasionList(g).join('|')}:${g.colorGroup || ''}:${(g.visualDescription || '').length}`
    )
    .sort()
    .join(',');

  const weatherSig = weatherData
    ? `${weatherData.condition || ''}:${weatherData.tempMin ?? ''}:${weatherData.tempMax ?? ''}`
    : 'default-weather';

  return [
    STYLE_CACHE_VERSION,
    hasApiKey ? 'gemini' : 'offline',
    activeSeason,
    occasion,
    anchorGarmentId || 'any',
    includeOuterwear ? 'with-outerwear' : 'no-outerwear',
    String(weatherNote || '').trim().toLowerCase(),
    String(stylePreferences || '').trim().toLowerCase(),
    weatherSig,
    cleanInSeasonSig
  ].join('::');
}

export const GEMINI_MODEL = 'gemini-2.5-flash';
export const GEMINI_FALLBACK_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash'
];
export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

function parseGeminiErrorMessage(errText, fallbackStatusText = '') {
  if (!errText) return fallbackStatusText || 'Unknown error';
  try {
    const parsed = JSON.parse(errText);
    if (parsed?.error?.message) {
      return parsed.error.message;
    }
  } catch (_) {
    // Not JSON, fall through
  }
  return errText.slice(0, 180);
}

async function discoverAvailableGeminiModels(apiKey, alreadyTried = new Set()) {
  try {
    const res = await fetch(`${GEMINI_API_BASE}?key=${encodeURIComponent(apiKey)}`);
    if (!res.ok) return [];
    const data = await res.json();
    const models = (data?.models || [])
      .filter(
        (m) =>
          Array.isArray(m.supportedGenerationMethods) &&
          m.supportedGenerationMethods.includes('generateContent') &&
          typeof m.name === 'string' &&
          m.name.includes('gemini') &&
          !m.name.includes('embedding') &&
          !m.name.includes('imagen') &&
          !m.name.includes('tts')
      )
      .map((m) => m.name.replace(/^models\//, ''))
      .filter((name) => !alreadyTried.has(name))
      .reverse();

    const flashModels = models.filter((name) => name.includes('flash'));
    const otherModels = models.filter((name) => !name.includes('flash'));
    return [...flashModels, ...otherModels].slice(0, 3);
  } catch (_) {
    return [];
  }
}

async function callGeminiGenerateContent({ apiKey, contents, responseSchema = null, temperature = 0.4 }) {
  let primaryError = null;
  let lastError = null;
  const candidateModels = [...GEMINI_FALLBACK_MODELS];
  const triedModels = new Set();
  let didDiscover = false;

  for (let i = 0; i < candidateModels.length; i++) {
    const modelName = candidateModels[i];
    if (triedModels.has(modelName)) continue;
    triedModels.add(modelName);

    const endpoint = `${GEMINI_API_BASE}/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const genConfig = {
      temperature,
      responseMimeType: 'application/json'
    };
    if (responseSchema) {
      genConfig.responseSchema = responseSchema;
    }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          generationConfig: genConfig
        })
      });

      if (response.ok) {
        const data = await response.json();
        return { data, modelName };
      }

      const errText = await response.text().catch(() => '');
      const cleanMsg = parseGeminiErrorMessage(errText, response.statusText);
      const currentError = new Error(`Gemini (${modelName}) HTTP ${response.status}: ${cleanMsg}`);
      lastError = currentError;
      if (!primaryError && response.status !== 404) {
        primaryError = currentError;
      }

      // If Google's error message explicitly recommends a model (e.g. "use models/gemini-3.8-flash"), queue it immediately
      const suggestedMatch = cleanMsg.match(/models\/([a-zA-Z0-9._-]+)/);
      if (suggestedMatch && suggestedMatch[1] && !triedModels.has(suggestedMatch[1]) && !candidateModels.includes(suggestedMatch[1])) {
        candidateModels.splice(i + 1, 0, suggestedMatch[1]);
      }

      // If API key itself is invalid (Google returns 400 API_KEY_INVALID or 401/403), stop immediately
      if (
        response.status === 401 ||
        response.status === 403 ||
        /API_KEY_INVALID|API key not valid|expired/i.test(errText)
      ) {
        throw currentError;
      }

      // If 400 Bad Request due to responseSchema incompatibility, retry once without responseSchema
      if (response.status === 400 && responseSchema) {
        const retryRes = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents,
            generationConfig: {
              temperature,
              responseMimeType: 'application/json'
            }
          })
        });
        if (retryRes.ok) {
          const data = await retryRes.json();
          return { data, modelName };
        }
      }

      // If static models returned 404, dynamically query /v1beta/models to find untried enabled models
      if (i === candidateModels.length - 1 && !primaryError && !didDiscover) {
        didDiscover = true;
        const discoveredList = await discoverAvailableGeminiModels(apiKey, triedModels);
        for (const dModel of discoveredList) {
          if (!candidateModels.includes(dModel)) {
            candidateModels.push(dModel);
          }
        }
      }
    } catch (err) {
      if (/API_KEY_INVALID|API key not valid|HTTP 401|HTTP 403/i.test(err.message)) {
        throw err;
      }
      lastError = err;
      if (!primaryError) primaryError = err;
      break;
    }
  }

  throw primaryError || lastError || new Error('Gemini API request failed');
}

export const AUTO_TAG_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: {
      type: 'STRING',
      description: 'Concise, descriptive title of the garment (e.g., "Navy Cable-Knit Crewneck")'
    },
    category: {
      type: 'STRING',
      enum: ['top', 'bottom', 'outerwear', 'one-piece', 'shoes', 'accessory'],
      description: 'Wardrobe slot category'
    },
    season: {
      type: 'STRING',
      enum: ['winter', 'summer', 'all-season'],
      description: 'Best season for wearing this garment'
    },
    tempSuitability: {
      type: 'STRING',
      enum: ['freezing', 'cold', 'mild', 'warm', 'all-temps'],
      description: 'Temperature range this garment is suited for: freezing (<5C), cold (5-14C), mild (15-22C), warm (>22C), or all-temps'
    },
    layerRole: {
      type: 'STRING',
      enum: ['base', 'mid', 'outer', 'single'],
      description: 'Layering role: "base" (t-shirt/shirt worn next to skin), "mid" (jumper/sweater/cardigan/hoodie worn over a base top), "outer" (jacket/coat), or "single" (bottoms/shoes/dresses)'
    },
    colorGroup: {
      type: 'STRING',
      enum: ['whites', 'coloured'],
      description: 'Laundry sorting color group: whites (pure white/ivory/cream) vs coloured'
    },
    delicate: {
      type: 'BOOLEAN',
      description: 'True if fabric appears delicate (wool, silk, cashmere, lace, knit, linen, tailored)'
    },
    type: {
      type: 'STRING',
      enum: ['everyday', 'gym', 'dress-up'],
      description: 'Primary occasion usage'
    },
    visualDescription: {
      type: 'STRING',
      description: 'Detailed visual description of exact colors, fabric texture, cut, and styling vibe'
    }
  },
  required: ['name', 'category', 'season', 'tempSuitability', 'layerRole', 'colorGroup', 'delicate', 'type', 'visualDescription']
};

export const GARMENT_DESCRIPTION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    garmentDetected: {
      type: 'BOOLEAN',
      description: 'True ONLY if at least one wearable garment, shoe, or fashion accessory is clearly visible in the uploaded media.'
    },
    visualDescription: {
      type: 'STRING',
      description: 'If garmentDetected is true, concise description of exact colors, fabric texture, cut, and fit. If false, empty string "".'
    },
    rejectionReason: {
      type: 'STRING',
      description: 'If garmentDetected is false, brief reason why no garment was found. If true, empty string "".'
    }
  },
  required: ['garmentDetected', 'visualDescription', 'rejectionReason']
};

export const OUTFIT_SUGGESTION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    outfits: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          garmentIds: {
            type: 'ARRAY',
            items: { type: 'STRING' }
          },
          explanation: { type: 'STRING' },
          layeringTips: { type: 'STRING' }
        },
        required: ['title', 'garmentIds', 'explanation', 'layeringTips']
      }
    }
  },
  required: ['outfits']
};

/**
 * Clean markdown code fences (```json ... ```) from LLM text output and parse JSON
 * @param {string|Object} rawOutput
 * @returns {Object}
 */
export function cleanJsonOutput(rawOutput) {
  if (!rawOutput) {
    throw new Error('Empty LLM response');
  }
  if (typeof rawOutput === 'object') {
    return rawOutput;
  }

  let text = String(rawOutput).trim();
  // Remove leading ```json or ``` and trailing ```
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // If surrounded by extra prose, extract first JSON object
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }

  return JSON.parse(text);
}

/**
 * Analyze a garment photo (and optional fit video) with Gemini Vision to auto-populate attributes
 * Falls back to a local heuristic analyzer if no API key is set.
 * @param {Blob|File|null} imageBlob
 * @param {string} [apiKey='']
 * @param {Blob|File|null} [videoBlob=null]
 * @returns {Promise<Object>}
 */
export async function analyzeGarmentPhoto(imageBlob, apiKey = '', videoBlob = null) {
  if (!imageBlob && !videoBlob) {
    throw new Error('analyzeGarmentPhoto: Image or Fit Video Blob is required');
  }

  const trimmedKey = String(apiKey || '').trim();
  if (!trimmedKey) {
    return fallbackHeuristicPhotoAnalysis(imageBlob || videoBlob, '', Boolean(videoBlob));
  }

  try {
    const mediaParts = [];
    if (imageBlob) {
      const optimized = await optimizeImageForGemini(imageBlob);
      mediaParts.push({
        inlineData: {
          mimeType: optimized.mimeType,
          data: optimized.base64
        }
      });
    }

    let videoFramesCount = 0;
    if (videoBlob) {
      const frames = await extractVideoKeyframes(videoBlob);
      for (const frame of frames) {
        if (frame && frame.base64) {
          mediaParts.push({
            inlineData: {
              mimeType: frame.mimeType || 'image/jpeg',
              data: frame.base64
            }
          });
          videoFramesCount++;
        }
      }
    }

    if (mediaParts.length === 0) {
      return fallbackHeuristicPhotoAnalysis(imageBlob || videoBlob, 'No media frames decoded', Boolean(videoBlob));
    }

    const prompt = [
      'You are an expert fashion archivist, tailor, and laundry care specialist.',
      videoFramesCount > 0
        ? `Analyze this garment photo AND the ${videoFramesCount} fit-video frame(s) showing how the garment actually fits and drapes on the wearer's body.`
        : 'Analyze this garment image and return a JSON object matching the schema:',
      '- name: short stylish title (e.g. "Charcoal Merino Sweater", "White Cotton Oxford")',
      '- category: one of "top", "bottom", "outerwear", "one-piece", "shoes", "accessory"',
      '- season: one of "winter", "summer", "all-season"',
      '- tempSuitability: one of "freezing" (<5°C), "cold" (5-14°C), "mild" (15-22°C), "warm" (>22°C), "all-temps"',
      '- layerRole: "base" if t-shirt/shirt/blouse/top worn as first layer; "mid" if jumper/sweater/cardigan/hoodie/vest worn over a base top; "outer" if coat/jacket; "single" for bottoms/shoes/dresses',
      '- colorGroup: "whites" if predominantly white/cream/ivory for laundry sorting, otherwise "coloured"',
      '- delicate: true if knitwear, wool, silk, linen, cashmere, sheer, or tailored; false if durable cotton/denim/synthetics',
      '- type: one of "everyday", "gym", "dress-up"',
      videoFramesCount > 0
        ? '- visualDescription: concise description of exact colors, fabric texture, AND how the garment fits on the wearer\'s body in the fit video (e.g., relaxed/oversized vs slim/tailored cut, cropped vs long hem placement, drape, and room for layering underneath/over).'
        : '- visualDescription: concise description of colors, pattern, silhouette, and fabric for an AI outfit stylist.'
    ].join('\n');

    const { data } = await callGeminiGenerateContent({
      apiKey: trimmedKey,
      temperature: 0.2,
      responseSchema: AUTO_TAG_SCHEMA,
      contents: [
        {
          parts: [{ text: prompt }, ...mediaParts]
        }
      ]
    });

    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    const parsed = cleanJsonOutput(rawText);

    return {
      name: parsed.name || 'Styled Garment',
      category: ['top', 'bottom', 'outerwear', 'one-piece', 'shoes', 'accessory'].includes(parsed.category)
        ? parsed.category
        : 'top',
      season: ['winter', 'summer', 'all-season'].includes(parsed.season)
        ? parsed.season
        : 'all-season',
      tempSuitability: ['freezing', 'cold', 'mild', 'warm', 'all-temps'].includes(parsed.tempSuitability)
        ? parsed.tempSuitability
        : 'all-temps',
      layerRole: ['base', 'mid', 'outer', 'single'].includes(parsed.layerRole)
        ? parsed.layerRole
        : 'base',
      colorGroup: parsed.colorGroup === 'whites' ? 'whites' : 'coloured',
      delicate: Boolean(parsed.delicate),
      type: ['everyday', 'gym', 'dress-up'].includes(parsed.type) ? parsed.type : 'everyday',
      visualDescription: parsed.visualDescription || '',
      analyzedFitVideo: videoFramesCount > 0,
      engine: 'gemini'
    };
  } catch (err) {
    return fallbackHeuristicPhotoAnalysis(imageBlob || videoBlob, err.message, Boolean(videoBlob));
  }
}

async function fallbackHeuristicPhotoAnalysis(imageBlob, reason = '', hasFitVideo = false) {
  // Inspect filename or canvas brightness if available
  const fileName = (imageBlob && imageBlob.name) ? imageBlob.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ') : '';
  const lower = fileName.toLowerCase();

  const isWhite = /white|ivory|cream|ecru/i.test(lower);
  const category = /pant|jean|trouser|short|skirt|chino/i.test(lower)
    ? 'bottom'
    : /coat|jacket|blazer|parka|cardigan|puffer/i.test(lower)
      ? 'outerwear'
      : /dress|jumpsuit|romper/i.test(lower)
        ? 'one-piece'
        : /shoe|boot|sneaker|loafer|heel/i.test(lower)
          ? 'shoes'
          : 'top';

  const season = /winter|wool|cashmere|knit|coat|sweater|puffer|boot/i.test(lower)
    ? 'winter'
    : /summer|linen|short|tank|sandal/i.test(lower)
      ? 'summer'
      : 'all-season';

  const delicate = /wool|silk|cashmere|delicate|lace|linen|knit/i.test(lower);
  const type = /gym|sport|run|athletic|workout/i.test(lower)
    ? 'gym'
    : /dress|suit|formal|silk|blazer|heel/i.test(lower)
      ? 'dress-up'
      : 'everyday';

  const tempSuitability = /parka|puffer|thermal|down|overcoat/i.test(lower)
    ? 'freezing'
    : season === 'winter'
      ? 'cold'
      : season === 'summer'
        ? 'warm'
        : 'all-temps';

  const layerRole =
    category === 'outerwear'
      ? 'outer'
      : category !== 'top'
        ? 'single'
        : /jumper|sweater|cardigan|hoodie|pullover|knit|fleece|vest|sweatshirt/i.test(lower)
          ? 'mid'
          : 'base';

  return {
    name: fileName ? fileName.charAt(0).toUpperCase() + fileName.slice(1) : 'New Wardrobe Piece',
    category,
    season,
    tempSuitability,
    layerRole,
    colorGroup: isWhite ? 'whites' : 'coloured',
    delicate,
    type,
    visualDescription: `Auto-detected ${season} ${category} (${isWhite ? 'light/white tones' : 'coloured palette'})${hasFitVideo ? ' with attached fit-video drape & body proportion reference.' : '.'}`,
    analyzedFitVideo: Boolean(hasFitVideo),
    engine: 'offline',
    fallbackReason: reason || 'No Gemini API key configured'
  };
}

/**
 * Build a structured metadata description from garment attributes and optional user details
 */
export function buildStructuredMetadataDescription(garment = {}, hasFitVideo = false) {
  const name = String(garment.name || 'Garment').trim();
  const season = garment.season || 'all-season';
  const category = garment.category || 'top';
  const layerRole = garment.layerRole || 'base';
  const colorGroup = garment.colorGroup || 'coloured';
  const careCategory =
    garment.careCategory || (garment.delicate ? 'delicate' : 'other');
  const occasion = Array.isArray(garment.type)
    ? garment.type.join(', ')
    : garment.type || 'everyday';
  const temps = Array.isArray(garment.tempSuitability)
    ? garment.tempSuitability.join(', ')
    : garment.tempSuitability || 'all-temps';
  const userDetails = String(garment.userDetails ?? garment.details ?? '').trim();

  const layerNote =
    category === 'top'
      ? `${layerRole}-layer ${category}`
      : category;

  const baseDesc = `${name} — ${season} ${occasion} ${layerNote} (${colorGroup} palette, ${careCategory} care, suited for ${temps} weather)${hasFitVideo ? ' with on-body fit video reference.' : '.'}`;
  return userDetails ? `${baseDesc} Details: ${userDetails}` : baseDesc;
}

/**
 * Automatically generate the AI metadata description of a garment when it is saved,
 * validating that a wearable garment is present in the uploaded photo/video and
 * combining the AI metadata description with any optional user-inserted details.
 */
export async function generateGarmentMetadataDescription(
  garment = {},
  photoBlob = null,
  apiKey = '',
  videoBlob = null
) {
  const hasFitVideo = Boolean(videoBlob || garment.videoMediaId);
  const trimmedKey = String(apiKey || '').trim();
  const userDetails = String(garment.userDetails ?? garment.details ?? '').trim();
  const appendUserDetails = (aiDesc) => {
    const cleanAi = String(aiDesc || '').trim();
    if (!userDetails) return cleanAi;
    if (cleanAi.toLowerCase().includes(userDetails.toLowerCase())) return cleanAi;
    return cleanAi ? `${cleanAi} Details: ${userDetails}` : userDetails;
  };

  if ((photoBlob || videoBlob) && trimmedKey) {
    try {
      const mediaParts = [];
      if (photoBlob) {
        const optimized = await optimizeImageForGemini(photoBlob);
        mediaParts.push({
          inlineData: {
            mimeType: optimized.mimeType,
            data: optimized.base64
          }
        });
      }

      let videoFramesCount = 0;
      if (videoBlob) {
        const frames = await extractVideoKeyframes(videoBlob);
        for (const frame of frames) {
          if (frame && frame.base64) {
            mediaParts.push({
              inlineData: {
                mimeType: frame.mimeType || 'image/jpeg',
                data: frame.base64
              }
            });
            videoFramesCount++;
          }
        }
      }

      if (mediaParts.length > 0) {
        const garmentName = String(garment.name || 'Garment').trim();
        const garmentCategory = String(garment.category || 'top').trim();
        const prompt = [
          `You are a precision fashion archivist. Inspect the uploaded media (user-tagged as "${garmentName}", category "${garmentCategory}").`,
          '1. Verify if a wearable item (clothing, footwear, bag, or fashion accessory — worn, on a hanger, folded, or flat-lay) is clearly visible.',
          '2. Set garmentDetected=false if the image shows NO wearable item (e.g., only a room/wall, furniture, food, pets, screenshots, text, or is too blurry/dark to identify any garment), set visualDescription="", and explain briefly in rejectionReason.',
          videoFramesCount > 0
            ? '3. If garmentDetected=true, set rejectionReason="" and write a concise visualDescription of exact colors, pattern, fabric texture, cut, and how the garment fits/drapes on the wearer\'s body in the fit video.'
            : '3. If garmentDetected=true, set rejectionReason="" and write a concise visualDescription of exact colors, pattern, fabric texture, cut, and silhouette for an outfit stylist.'
        ].join('\n');

        const { data } = await callGeminiGenerateContent({
          apiKey: trimmedKey,
          temperature: 0.1,
          responseSchema: GARMENT_DESCRIPTION_SCHEMA,
          contents: [
            {
              parts: [{ text: prompt }, ...mediaParts]
            }
          ]
        });

        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        const parsed = cleanJsonOutput(rawText);

        if (parsed && parsed.garmentDetected === false) {
          return {
            garmentDetected: false,
            rejectionReason:
              String(parsed.rejectionReason || '').trim() ||
              'No wearable garment could be identified in the uploaded photo.',
            visualDescription: '',
            engine: 'gemini'
          };
        }

        const aiDesc = String(parsed?.visualDescription || '').trim();
        return {
          garmentDetected: true,
          rejectionReason: '',
          visualDescription: aiDesc
            ? appendUserDetails(aiDesc)
            : buildStructuredMetadataDescription(garment, hasFitVideo),
          engine: 'gemini'
        };
      }
    } catch (_) {
      // On network/API failure, fall back to offline structured metadata description
    }
  }

  return {
    garmentDetected: true,
    rejectionReason: '',
    visualDescription: buildStructuredMetadataDescription(garment, hasFitVideo),
    engine: 'offline'
  };
}

/**
 * Generate 2-3 curated outfit suggestions for tomorrow using Google Gemini AI
 * Automatically falls back to offlineStylist on missing API key or API/network failure.
 * @param {Object} params
 * @returns {Promise<{ outfits: Array<Object>, engine: 'gemini'|'offline', message?: string }>}
 */
export async function suggestTomorrowOutfits({
  garments = [],
  occasion = 'everyday',
  activeSeason = 'winter',
  anchorGarmentId = null,
  weatherNote = '',
  weatherData = null,
  apiKey = '',
  stylePreferences = '',
  wearCounts = {},
  forceRefresh = false,
  persistedCache = null,
  includeOuterwear = false
} = {}) {
  const trimmedKey = String(apiKey || '').trim();
  const trimmedStylePreferences = String(stylePreferences || '').trim();

  // Pre-filter candidate pool strictly to the selected occasion wardrobe (everyday, gym, dress-up are independent), clean + in-season garments (excluding outerwear unless includeOuterwear=true or anchored).
  // Note: Gym garments are worn year-round for workouts regardless of season.
  const cleanInSeason = (garments || []).filter(
    (g) =>
      g &&
      g.status === 'clean' &&
      garmentMatchesOccasion(g, occasion) &&
      (occasion === 'gym' || !g.season || g.season === activeSeason || g.season === 'all-season') &&
      (includeOuterwear || g.category !== 'outerwear' || g.id === anchorGarmentId)
  );

  const cacheKey = computeOutfitCacheKey({
    garments,
    occasion,
    activeSeason,
    anchorGarmentId,
    weatherNote,
    weatherData,
    hasApiKey: Boolean(trimmedKey),
    includeOuterwear,
    stylePreferences: trimmedStylePreferences
  });

  if (!forceRefresh && cleanInSeason.length >= 2) {
    const cachedEntry =
      OUTFIT_SUGGESTION_CACHE.get(cacheKey) ||
      (persistedCache && typeof persistedCache === 'object' ? persistedCache[cacheKey] : null);

    if (
      cachedEntry &&
      Array.isArray(cachedEntry.outfits) &&
      cachedEntry.outfits.length > 0 &&
      (!trimmedKey || cachedEntry.engine === 'gemini')
    ) {
      const sortedCachedOutfits = sortOutfitsByWearPreference(cachedEntry.outfits, wearCounts);
      OUTFIT_SUGGESTION_CACHE.set(cacheKey, {
        ...cachedEntry,
        outfits: sortedCachedOutfits
      });
      return {
        ...cachedEntry,
        outfits: sortedCachedOutfits,
        fromCache: true,
        cacheKey
      };
    }
  }

  // If no API key or not enough items, run the deterministic offline stylist immediately
  if (!trimmedKey || cleanInSeason.length < 2) {
    const offlineResult = generateOfflineOutfits({
      garments,
      occasion,
      activeSeason,
      anchorGarmentId,
      weatherData,
      wearCounts,
      includeOuterwear,
      shuffle: Boolean(forceRefresh)
    });
    if (offlineResult.outfits && offlineResult.outfits.length > 0) {
      OUTFIT_SUGGESTION_CACHE.set(cacheKey, offlineResult);
    }
    return {
      ...offlineResult,
      fromCache: false,
      cacheKey
    };
  }

  try {
    const garmentById = new Map(cleanInSeason.map((g) => [g.id, g]));
    const inventorySummary = cleanInSeason.map((g) => {
      const feat = inspectGarmentFeatures(g);
      return {
        id: g.id,
        name: g.name,
        category: g.category,
        season: g.season,
        tempSuitability: inferTempSuitabilityList(g),
        layerRole: inferLayerRole(g),
        colorGroup: g.colorGroup,
        type: g.type,
        hasFitVideo: Boolean(g.videoMediaId),
        construction: {
          closureType: feat.closureType,
          sleeveType: feat.sleeveType,
          necklineType: feat.necklineType,
          isCropped: feat.isCropped,
          silhouette: feat.silhouette
        },
        visualDescription: g.visualDescription || ''
      };
    });

    const anchorItem = anchorGarmentId
      ? cleanInSeason.find((g) => g.id === anchorGarmentId)
      : null;

    const weatherContextStr = weatherData
      ? `Tomorrow forecast: ${weatherData.condition || ''}, Min ${weatherData.tempMin}°C / Max ${weatherData.tempMax}°C, Rain chance: ${weatherData.rainProb || 0}%. ${weatherNote || ''}`
      : weatherNote || 'Standard seasonal weather';

    // Summarize favorite previously-worn combinations where all items are currently clean & in-season
    const validIds = new Set(cleanInSeason.map((g) => g.id));
    const favoriteCombos = Object.entries(wearCounts || {})
      .filter(([key, count]) => {
        if (!count || count <= 0) return false;
        const ids = key.split('|').filter(Boolean);
        if (ids.length < 2 || !ids.every((id) => validIds.has(id))) return false;
        if (anchorItem && !ids.includes(anchorItem.id)) return false;
        return true;
      })
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([key, count]) => ({ garmentIds: key.split('|'), wornCount: count }));

    const favoritePreferenceClause =
      favoriteCombos.length > 0
        ? `USER FAVORITE COMBINATIONS (Previously Worn & Loved): ${JSON.stringify(favoriteCombos)}. Where appropriate for the occasion and weather, include or prioritize favorite combinations with higher wornCount so the user's preferred outfits appear first.`
        : '';

    const personalStylePreferenceClause = trimmedStylePreferences
      ? `USER PERSONAL STYLING & COLOR PREFERENCES (Follow strictly when selecting pairings and writing layeringTips): "${trimmedStylePreferences}"`
      : '';

    const outerwearClause = includeOuterwear
      ? '- Include outerwear/jackets when appropriate for the temperature or rain.'
      : '- Do NOT include jackets or coats (category="outerwear"), as the user uses their standard seasonal jacket separately. Focus on base + mid-layer tops, bottoms, one-pieces, shoes, and accessories.';

    const refreshVariationClause = forceRefresh
      ? `REFRESH REQUEST (Seed ${Date.now() % 10000}): Generate fresh, newly shuffled outfit pairings that explore different combinations from the inventory.`
      : '';

    const layeringRuleClause =
      occasion === 'gym'
        ? '- GYM LAYERING RULE: For "gym" outfits, the standard layering is Top (Sports Bra + Sports T-shirt) + Bottom Trousers/Leggings (plus gym shoes if available). Always combine both the sports bra and the sports T-shirt together with the bottom trousers when available in the inventory.'
        : '- In winter or cold/chilly weather (< 16°C), do NOT suggest only a single thin top! Combine a base-layer top (layerRole="base", e.g. t-shirt/shirt) AND a mid-layer top (layerRole="mid", e.g. jumper/sweater/cardigan/hoodie) PLUS a bottom and shoes when available.';

    const prompt = [
      'You are a personal luxury fashion stylist.',
      `Create up to 10 complete, distinct, stylish outfit combinations (as many unique valid combinations as the inventory supports, up to a maximum of 10) for tomorrow from the user's CLEAN "${occasion}" wardrobe inventory below.`,
      `Target Occasion: "${occasion}"`,
      `Active Season: "${activeSeason}"`,
      `Weather Context: "${weatherContextStr}"`,
      personalStylePreferenceClause,
      'MULTI-LAYERING, TEMPERATURE SUITABILITY & FIT-VIDEO PROPORTION RULES:',
      layeringRuleClause,
      '- Match each garment\'s tempSuitability ("freezing", "cold", "mild", "warm", "all-temps") to the forecast temperature.',
      outerwearClause,
      '- Pay close attention to each garment\'s fit, cut, and drape notes in `visualDescription` and `construction` (captured from the user\'s on-body fit videos when `hasFitVideo` is true). Balance silhouettes across layers (e.g., pair relaxed/oversized jumpers with cleaner base layers or structured bottoms).',
      '- ELEVATED & GARMENT-ACCURATE STYLING TIPS (`layeringTips`): Write a unique, tailored styling instruction for each outfit that strictly respects each garment\'s actual physical construction (`construction.closureType`, `construction.sleeveType`, `construction.necklineType`, `construction.isCropped`):',
      '  1. NO PHANTOM BUTTONS: NEVER suggest buttoning or unbuttoning a garment unless its `closureType` is `"buttoned"` (e.g., a cardigan, button-down shirt, or buttoned coat). Pullovers, crewnecks, turtlenecks, hoodies, T-shirts, and quarter-zip sweatshirts do NOT have buttons (for `closureType="quarter-zip"`, refer to unzipping the collar zipper partway).',
      '  2. NO PHANTOM LONG SLEEVES: NEVER suggest letting base-layer wrist cuffs peek out from under a sweater/jumper or cuffing base sleeves over a sweater when the base top has `sleeveType` `"short-sleeve"`, `"cap-sleeve"`, or `"sleeveless"`. Short-sleeve and cap-sleeve tees do not reach the wrists.',
      '  3. REALISTIC NECKLINES & HEMS: NEVER suggest letting a base layer\'s neckline peek out above a `"turtleneck"` mid-layer (which covers the neck completely). If a garment has `isCropped=true`, let its cropped hem sit cleanly at the waistband rather than suggesting tucking it in.',
      '  4. NO REPETITIVE TEMPLATES: Every outfit in `outfits` MUST have a distinct, varied `layeringTips` tailored to its specific garments, necklines, waistbands, and trouser drape. NEVER write generic weather advice like "remove the outer layer indoors if warm".',
      favoritePreferenceClause,
      refreshVariationClause,
      anchorItem
        ? `CRITICAL REQUIREMENT: Every single suggested outfit MUST include the anchor garment ID "${anchorItem.id}" (${anchorItem.name}).`
        : 'Combine base/mid tops + bottoms (or one-piece) + optional shoes/accessories that harmonize in color and silhouette.',
      'Only use garment IDs that exist in the provided inventory JSON.',
      'Return a JSON object with shape: { "outfits": [ { "title": "...", "garmentIds": ["..."], "explanation": "Detailed fashion stylist explanation of why the colors, fabrics, and on-body fit proportions work together", "layeringTips": "Unique, garment-accurate styling instructions tailored to the exact cuts, closures, sleeve lengths, and necklines in this outfit" } ] }',
      `Available Clean Inventory JSON:\n${JSON.stringify(inventorySummary, null, 2)}`
    ]
      .filter(Boolean)
      .join('\n\n');

    const { data } = await callGeminiGenerateContent({
      apiKey: trimmedKey,
      temperature: forceRefresh ? 0.85 : 0.5,
      responseSchema: OUTFIT_SUGGESTION_SCHEMA,
      contents: [{ parts: [{ text: prompt }] }]
    });

    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    const parsed = cleanJsonOutput(rawText);

    if (!parsed || !Array.isArray(parsed.outfits) || parsed.outfits.length === 0) {
      throw new Error('Gemini returned empty outfits array');
    }

    const seenComboKeys = new Set();
    const seenTipTexts = new Set();

    const isTipValidForGarments = (tip, outfitGarments) => {
      const trimmed = String(tip || '').trim();
      if (!trimmed) return false;
      const features = outfitGarments.map((g) => ({ garment: g, feat: inspectGarmentFeatures(g) }));
      const anyButtoned = features.some(({ feat }) => feat.closureType === 'buttoned');
      // Reject if tip suggests buttoning/unbuttoning when no garment in the outfit has buttons
      if (!anyButtoned && /\b(buttons?|buttoned|unbutton(ed)?)\b/i.test(trimmed)) {
        return false;
      }
      // Reject if tip suggests base cuffs peeking out from a sweater when the base top is not long-sleeve
      const baseTop = outfitGarments.find((g) => g.category === 'top' && inferLayerRole(g) === 'base');
      const midTop = outfitGarments.find((g) => g.category === 'top' && inferLayerRole(g) === 'mid');
      if (baseTop && midTop) {
        const baseFeat = inspectGarmentFeatures(baseTop);
        const midFeat = inspectGarmentFeatures(midTop);
        if (
          baseFeat.sleeveType !== 'long-sleeve' &&
          /\b(cuffs?\s+peek|peek\s+out.*cuffs?|1\s*cm\s+of\s+the\s+cuffs?)\b/i.test(trimmed)
        ) {
          return false;
        }
        if (
          midFeat.necklineType === 'turtleneck' &&
          /\b(neckline|collar)\b.*\bpeek\s+out\b/i.test(trimmed)
        ) {
          return false;
        }
      }
      return true;
    };

    const sanitizedOutfits = parsed.outfits
      .map((o, idx) => {
        const filteredIds = (o.garmentIds || []).filter((id) => validIds.has(id));
        if (anchorItem && !filteredIds.includes(anchorItem.id)) {
          filteredIds.unshift(anchorItem.id);
        }
        const comboKey = buildCombinationKey(filteredIds);
        const wornCount = wearCounts && typeof wearCounts[comboKey] === 'number' ? wearCounts[comboKey] : 0;
        const outfitGarments = filteredIds.map((id) => garmentById.get(id)).filter(Boolean);
        const hasCoat = outfitGarments.some((g) => g.category === 'outerwear');
        const topItems = outfitGarments.filter((g) => g.category === 'top');
        const hasMidLayer = topItems.length >= 2 || topItems.some((g) => inferLayerRole(g) === 'mid');

        const rawTip = String(o.layeringTips || '').trim();
        const normTip = rawTip.toLowerCase();
        const useAiTip =
          isTipValidForGarments(rawTip, outfitGarments) && !seenTipTexts.has(normTip);
        const finalTip = useAiTip
          ? rawTip
          : buildLayeringTip(weatherData, activeSeason, hasMidLayer, hasCoat, outfitGarments, idx);
        seenTipTexts.add(finalTip.toLowerCase());

        return {
          id: `gemini_outfit_${idx + 1}_${Date.now()}`,
          title: o.title || `Curated Look #${idx + 1}`,
          garmentIds: filteredIds,
          combinationKey: comboKey,
          wornCount,
          explanation: o.explanation || 'Selected for color harmony and seasonal fit.',
          layeringTips: finalTip || 'Wear with clean proportions.',
          occasion,
          season: activeSeason
        };
      })
      .filter((o) => {
        if (o.garmentIds.length < 1 || seenComboKeys.has(o.combinationKey)) return false;
        seenComboKeys.add(o.combinationKey);
        return true;
      })
      .slice(0, 10);

    if (sanitizedOutfits.length === 0) {
      throw new Error('No valid garment IDs in Gemini outfit response');
    }

    const sortedOutfits = sortOutfitsByWearPreference(sanitizedOutfits, wearCounts).slice(0, 10);
    const geminiResult = {
      engine: 'gemini',
      outfits: sortedOutfits,
      fromCache: false,
      cacheKey,
      styleVersion: STYLE_CACHE_VERSION,
      message: `Styled ${sortedOutfits.length} look(s) with Google Gemini AI.`
    };

    OUTFIT_SUGGESTION_CACHE.set(cacheKey, geminiResult);
    return geminiResult;
  } catch (err) {
    // Graceful fallback to 100% offline rule-based stylist
    const fallbackResult = generateOfflineOutfits({
      garments,
      occasion,
      activeSeason,
      anchorGarmentId,
      weatherData,
      wearCounts,
      includeOuterwear,
      shuffle: Boolean(forceRefresh)
    });
    return {
      ...fallbackResult,
      fromCache: false,
      cacheKey,
      fallbackReason: err.message
    };
  }
}

export async function testGeminiApiKey(apiKey = '') {
  const trimmedKey = String(apiKey || '').trim();
  if (!trimmedKey) {
    throw new Error('Please paste a Gemini API key first.');
  }
  const { modelName } = await callGeminiGenerateContent({
    apiKey: trimmedKey,
    temperature: 0,
    contents: [{ parts: [{ text: 'Reply with {"status":"ok"}' }] }]
  });
  return { ok: true, model: modelName };
}

export default {
  AUTO_TAG_SCHEMA,
  OUTFIT_SUGGESTION_SCHEMA,
  cleanJsonOutput,
  computeOutfitCacheKey,
  clearOutfitSuggestionCache,
  analyzeGarmentPhoto,
  suggestTomorrowOutfits,
  testGeminiApiKey
};
