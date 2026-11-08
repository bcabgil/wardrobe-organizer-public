/**
 * weatherService.js - Open-Meteo Tomorrow Forecast & WMO Weather Code Synthesizer
 * Free, zero-API-key weather lookup with offline fallback.
 */

const WMO_CODE_MAP = {
  0: { condition: 'Clear sky (Sunny)', icon: '☀️', isRainy: false, isSnowy: false, isCold: false },
  1: { condition: 'Mainly clear', icon: '🌤️', isRainy: false, isSnowy: false, isCold: false },
  2: { condition: 'Partly cloudy', icon: '⛅', isRainy: false, isSnowy: false, isCold: false },
  3: { condition: 'Overcast', icon: '☁️', isRainy: false, isSnowy: false, isCold: false },
  45: { condition: 'Foggy', icon: '🌫️', isRainy: false, isSnowy: false, isCold: true },
  48: { condition: 'Depositing rime fog', icon: '🌫️', isRainy: false, isSnowy: false, isCold: true },
  51: { condition: 'Light drizzle', icon: '🌦️', isRainy: true, isSnowy: false, isCold: false },
  53: { condition: 'Moderate drizzle', icon: '🌦️', isRainy: true, isSnowy: false, isCold: false },
  55: { condition: 'Dense drizzle', icon: '🌧️', isRainy: true, isSnowy: false, isCold: false },
  56: { condition: 'Light freezing drizzle', icon: '🌧️', isRainy: true, isSnowy: true, isCold: true },
  57: { condition: 'Dense freezing drizzle', icon: '🌧️', isRainy: true, isSnowy: true, isCold: true },
  61: { condition: 'Slight rain', icon: '🌧️', isRainy: true, isSnowy: false, isCold: false },
  63: { condition: 'Moderate rain', icon: '🌧️', isRainy: true, isSnowy: false, isCold: false },
  65: { condition: 'Heavy rain', icon: '🌧️', isRainy: true, isSnowy: false, isCold: false },
  66: { condition: 'Light freezing rain', icon: '🌨️', isRainy: true, isSnowy: true, isCold: true },
  67: { condition: 'Heavy freezing rain', icon: '🌨️', isRainy: true, isSnowy: true, isCold: true },
  71: { condition: 'Slight snowfall', icon: '❄️', isRainy: false, isSnowy: true, isCold: true },
  73: { condition: 'Moderate snowfall', icon: '❄️', isRainy: false, isSnowy: true, isCold: true },
  75: { condition: 'Heavy snowfall', icon: '❄️', isRainy: false, isSnowy: true, isCold: true },
  77: { condition: 'Snow grains', icon: '❄️', isRainy: false, isSnowy: true, isCold: true },
  80: { condition: 'Slight rain showers', icon: '🌦️', isRainy: true, isSnowy: false, isCold: false },
  81: { condition: 'Moderate rain showers', icon: '🌧️', isRainy: true, isSnowy: false, isCold: false },
  82: { condition: 'Violent rain showers', icon: '⛈️', isRainy: true, isSnowy: false, isCold: false },
  85: { condition: 'Slight snow showers', icon: '🌨️', isRainy: false, isSnowy: true, isCold: true },
  86: { condition: 'Heavy snow showers', icon: '❄️', isRainy: false, isSnowy: true, isCold: true },
  95: { condition: 'Thunderstorm', icon: '⛈️', isRainy: true, isSnowy: false, isCold: false },
  96: { condition: 'Thunderstorm with slight hail', icon: '⛈️', isRainy: true, isSnowy: false, isCold: true },
  99: { condition: 'Thunderstorm with heavy hail', icon: '⛈️', isRainy: true, isSnowy: false, isCold: true }
};

/**
 * Interpret standard WMO weather code into structured condition metadata
 * @param {number} code
 * @returns {{ code: number, condition: string, icon: string, isRainy: boolean, isSnowy: boolean, isCold: boolean }}
 */
export function interpretWmoCode(code) {
  const numericCode = Number(code);
  if (Number.isFinite(numericCode) && WMO_CODE_MAP[numericCode]) {
    return {
      code: numericCode,
      ...WMO_CODE_MAP[numericCode]
    };
  }
  return {
    code: numericCode,
    condition: 'Variable sky conditions',
    icon: '🌤️',
    isRainy: false,
    isSnowy: false,
    isCold: false
  };
}

/**
 * Synthesize a natural-language weather summary and wardrobe advice for tomorrow
 * @param {Object} forecast
 * @returns {string}
 */
export function synthesizeWeatherSummary(forecast = {}) {
  const tempMin = forecast.tempMin ?? 10;
  const tempMax = forecast.tempMax ?? 18;
  const rainProb = forecast.rainProb ?? 0;
  const wmo = interpretWmoCode(forecast.weatherCode ?? 0);
  const conditionText = forecast.condition || wmo.condition;

  const adviceParts = [];

  if (tempMax <= 0 || tempMin <= -5) {
    adviceParts.push('Freezing conditions — bundle up with a heavy coat and thermal layers');
  } else if (tempMax <= 14) {
    adviceParts.push('Cool temperatures — layer with a warm sweater or outerwear jacket');
  } else if (tempMax >= 30) {
    adviceParts.push('Hot weather — choose breathable cotton or linen pieces and skip heavy layers');
  } else {
    adviceParts.push('Mild temperatures — ideal for light transitional layering');
  }

  if (rainProb >= 50 || wmo.isRainy) {
    adviceParts.push(`bring a water-resistant jacket or umbrella (${rainProb}% rain chance)`);
  } else if (wmo.isSnowy) {
    adviceParts.push('wear weather-proof boots and insulated outerwear for snow');
  }

  return `Tomorrow: ${conditionText}, ${tempMin}°C to ${tempMax}°C. ${adviceParts.join(', ')}.`;
}

/**
 * Parse Open-Meteo daily forecast payload to extract tomorrow's index (index 1, or 0 if single day)
 * @param {Object} apiResponse
 * @returns {Object}
 */
export function parseOpenMeteoResponse(apiResponse) {
  if (!apiResponse || !apiResponse.daily) {
    throw new Error('Invalid Open-Meteo response: missing daily object');
  }

  const daily = apiResponse.daily;
  const idx = Array.isArray(daily.time) && daily.time.length > 1 ? 1 : 0;

  const tempMax = Number(daily.temperature_2m_max?.[idx] ?? 16);
  const tempMin = Number(daily.temperature_2m_min?.[idx] ?? 8);
  const rainProb = Number(daily.precipitation_probability_max?.[idx] ?? 0);
  const weatherCode = Number(daily.weathercode?.[idx] ?? 0);
  const date = daily.time?.[idx] || new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  const wmo = interpretWmoCode(weatherCode);
  const result = {
    date,
    tempMax,
    tempMin,
    rainProb,
    weatherCode,
    condition: wmo.condition,
    icon: wmo.icon,
    isRainy: wmo.isRainy || rainProb >= 50,
    isSnowy: wmo.isSnowy,
    isFallback: false
  };

  result.summary = synthesizeWeatherSummary(result);
  return result;
}

/**
 * Geocode a city name to coordinates using Open-Meteo Geocoding API
 * @param {string} cityName
 * @returns {Promise<{ lat: number, lon: number, name: string, country: string } | null>}
 */
export async function geocodeCity(cityName) {
  if (!cityName || !String(cityName).trim()) return null;
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName.trim())}&count=1&language=en&format=json`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const match = data?.results?.[0];
    if (!match) return null;
    return {
      lat: match.latitude,
      lon: match.longitude,
      name: match.name,
      country: match.country || ''
    };
  } catch (_) {
    return null;
  }
}

/**
 * Fetch tomorrow's weather forecast from Open-Meteo with graceful offline fallback
 * @param {Object} [options]
 * @param {number} [options.lat]
 * @param {number} [options.lon]
 * @param {string} [options.cityName]
 * @param {string} [options.activeSeason='winter']
 * @returns {Promise<Object>}
 */
export async function getTomorrowWeather({
  lat = null,
  lon = null,
  cityName = '',
  activeSeason = 'winter'
} = {}) {
  try {
    let targetLat = lat;
    let targetLon = lon;
    let resolvedCity = cityName || 'Local Forecast';

    if ((targetLat === null || targetLon === null) && cityName) {
      const geo = await geocodeCity(cityName);
      if (geo) {
        targetLat = geo.lat;
        targetLon = geo.lon;
        resolvedCity = `${geo.name}${geo.country ? `, ${geo.country}` : ''}`;
      }
    }

    // Default coordinates (Madrid/Central Europe fallback) if none provided
    if (targetLat === null || targetLon === null) {
      targetLat = 40.4168;
      targetLon = -3.7038;
    }

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${targetLat}&longitude=${targetLon}&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=2`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Open-Meteo HTTP ${response.status}`);
    }

    const data = await response.json();
    const parsed = parseOpenMeteoResponse(data);
    return {
      ...parsed,
      cityName: resolvedCity
    };
  } catch (_) {
    // Graceful offline fallback based on activeSeason
    const isWinter = activeSeason === 'winter';
    const fallback = {
      date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      tempMin: isWinter ? 6 : 19,
      tempMax: isWinter ? 13 : 27,
      rainProb: isWinter ? 25 : 10,
      weatherCode: isWinter ? 2 : 0,
      condition: isWinter ? 'Cool & partly cloudy' : 'Warm & sunny',
      icon: isWinter ? '⛅' : '☀️',
      isRainy: false,
      isSnowy: false,
      cityName: cityName || 'Offline Seasonal Estimate',
      isFallback: true
    };
    fallback.summary = synthesizeWeatherSummary(fallback);
    return fallback;
  }
}

export default {
  interpretWmoCode,
  synthesizeWeatherSummary,
  parseOpenMeteoResponse,
  geocodeCity,
  getTomorrowWeather
};
