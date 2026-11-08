/**
 * src/utils/mediaUtils.js
 * 
 * WebKit-Safe Media Storage & Media Utilities for Wardrobe Organizer PWA.
 * Provides safe ArrayBuffer <-> Blob conversions, MediaUrlManager object URL
 * lifecycle management, and cross-platform inline video player construction.
 */

// Bidirectional MIME <-> Extension dictionaries
const MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'video/x-m4v': '.m4v',
  'application/json': '.json',
  'application/zip': '.zip'
};

const EXT_TO_MIME = {
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'png': 'image/png',
  'webp': 'image/webp',
  'gif': 'image/gif',
  'svg': 'image/svg+xml',
  'mp4': 'video/mp4',
  'mov': 'video/quicktime',
  'webm': 'video/webm',
  'm4v': 'video/mp4',
  'json': 'application/json',
  'zip': 'application/zip'
};

/**
 * Converts a Blob or File to an ArrayBuffer safely across iOS WebKit and Android Blink.
 *
 * @param {Blob|File|ArrayBuffer|ArrayBufferView} input
 * @returns {Promise<ArrayBuffer>}
 */
export async function blobToArrayBuffer(input) {
  if (input === null || input === undefined) {
    throw new TypeError('blobToArrayBuffer: input is null or undefined');
  }

  // Already an ArrayBuffer (including cross-realm IndexedDB ArrayBuffers)
  if (
    input instanceof ArrayBuffer ||
    Object.prototype.toString.call(input) === '[object ArrayBuffer]'
  ) {
    return input;
  }

  // TypedArray or DataView
  if (ArrayBuffer.isView(input)) {
    return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  }

  // Modern standard Blob.arrayBuffer()
  if (typeof input.arrayBuffer === 'function') {
    try {
      return await input.arrayBuffer();
    } catch (e) {
      // Fall through to FileReader fallback if native arrayBuffer() fails
    }
  }

  // Fallback using FileReader (iOS Safari legacy support)
  return new Promise((resolve, reject) => {
    if (typeof FileReader === 'undefined') {
      return reject(new Error('FileReader is not supported in this environment'));
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('FileReader failed to read Blob as ArrayBuffer'));
    reader.readAsArrayBuffer(input);
  });
}

/**
 * Reconstructs a Blob from an ArrayBuffer and explicit MIME type.
 *
 * @param {ArrayBuffer|ArrayBufferView|Blob|string} arrayBuffer
 * @param {string} [mimeType='application/octet-stream']
 * @returns {Blob}
 */
export function arrayBufferToBlob(arrayBuffer, mimeType = 'application/octet-stream') {
  if (arrayBuffer === null || arrayBuffer === undefined) {
    throw new TypeError('arrayBufferToBlob: arrayBuffer is required');
  }

  const cleanMime = typeof mimeType === 'string' && mimeType.trim()
    ? mimeType.trim().toLowerCase()
    : 'application/octet-stream';

  if (typeof Blob !== 'undefined' && arrayBuffer instanceof Blob) {
    return arrayBuffer.type === cleanMime ? arrayBuffer : new Blob([arrayBuffer], { type: cleanMime });
  }

  if (ArrayBuffer.isView(arrayBuffer)) {
    return new Blob([arrayBuffer], { type: cleanMime });
  }

  if (
    arrayBuffer instanceof ArrayBuffer ||
    Object.prototype.toString.call(arrayBuffer) === '[object ArrayBuffer]'
  ) {
    return new Blob([new Uint8Array(arrayBuffer)], { type: cleanMime });
  }

  // If stored as a Base64 ASCII string directly
  if (typeof arrayBuffer === 'string' && arrayBuffer.length > 0) {
    const cleanB64 = arrayBuffer.replace(/^data:[^;]+;base64,/i, '').replace(/\s+/g, '');
    const bin = atob(cleanB64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return new Blob([bytes], { type: cleanMime });
  }

  throw new TypeError('arrayBufferToBlob: provided data is not an ArrayBuffer or ArrayBufferView');
}

/**
 * Converts a Blob to a Base64 Data URL string.
 *
 * @param {Blob|File} blob
 * @returns {Promise<string>}
 */
export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    if (!blob) {
      return reject(new TypeError('blobToDataUrl: blob is required'));
    }
    if (typeof FileReader === 'undefined') {
      return reject(new Error('FileReader is not supported in this environment'));
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('FileReader failed to read Blob as DataURL'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Converts a Base64 Data URL string to a reconstituted Blob.
 *
 * @param {string} dataUrl
 * @returns {Blob}
 */
export function dataUrlToBlob(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    throw new TypeError('dataUrlToBlob: invalid data URL string');
  }

  const parts = dataUrl.split(',');
  if (parts.length < 2) {
    throw new Error('dataUrlToBlob: malformed data URL');
  }

  const header = parts[0];
  const base64Data = parts[1];
  const mimeMatch = header.match(/data:(.*?)(;base64)?$/);
  const mimeType = mimeMatch && mimeMatch[1] ? mimeMatch[1] : 'application/octet-stream';

  const binaryString = atob(base64Data);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return new Blob([bytes], { type: mimeType });
}

/**
 * Encodes an ArrayBuffer or TypedArray to a Base64 string safely using chunking.
 *
 * @param {ArrayBuffer|ArrayBufferView} buffer
 * @returns {string}
 */
export function arrayBufferToBase64(buffer) {
  if (!buffer) return '';
  const bytes = ArrayBuffer.isView(buffer)
    ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    : new Uint8Array(buffer);

  const CHUNK_SIZE = 0x8000; // 32KB chunking prevents stack overflow in String.fromCharCode
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

/**
 * Decodes a Base64 string into an ArrayBuffer.
 *
 * @param {string} base64
 * @returns {ArrayBuffer}
 */
export function base64ToArrayBuffer(base64) {
  if (!base64 || typeof base64 !== 'string') return new ArrayBuffer(0);
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Infers the MIME type from a given filename or path based on its extension.
 *
 * @param {string} filename
 * @returns {string} MIME type or 'application/octet-stream'
 */
export function getMimeTypeFromFilename(filename) {
  if (!filename || typeof filename !== 'string') return 'application/octet-stream';
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex === -1) return 'application/octet-stream';
  const ext = filename.slice(dotIndex + 1).toLowerCase();
  return EXT_TO_MIME[ext] || 'application/octet-stream';
}

/**
 * Infers the standard file extension (including leading dot) from a MIME type.
 *
 * @param {string} mimeType
 * @returns {string} Extension (e.g. '.jpg', '.mov') or '.bin'
 */
export function getExtensionFromMimeType(mimeType) {
  if (!mimeType || typeof mimeType !== 'string') return '.bin';
  const cleanMime = mimeType.split(';')[0].trim().toLowerCase();
  return MIME_TO_EXT[cleanMime] || '.bin';
}

/**
 * Checks if a MIME type represents an image asset.
 *
 * @param {string} mimeType
 * @returns {boolean}
 */
export function isImageMime(mimeType) {
  return typeof mimeType === 'string' && mimeType.toLowerCase().startsWith('image/');
}

/**
 * Checks if a MIME type represents a video asset.
 *
 * @param {string} mimeType
 * @returns {boolean}
 */
export function isVideoMime(mimeType) {
  return typeof mimeType === 'string' && mimeType.toLowerCase().startsWith('video/');
}

/**
 * Manages the lifecycle of Object URLs created via URL.createObjectURL().
 * Tracks all active URLs and provides targeted and bulk revocation to prevent
 * memory exhaustion on iOS Safari and Android Chrome.
 */
export class MediaUrlManager {
  constructor() {
    this._activeUrls = new Set();
  }

  /**
   * Creates an Object URL for the given Blob and tracks it.
   *
   * @param {Blob|File} blob
   * @returns {string}
   */
  createUrl(blob) {
    if (!blob) return '';
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      return '';
    }
    const url = URL.createObjectURL(blob);
    this._activeUrls.add(url);
    return url;
  }

  /**
   * Revokes a specific Object URL and removes it from tracking.
   *
   * @param {string} url
   * @returns {boolean} True if URL was tracked and revoked, false otherwise.
   */
  revoke(url) {
    if (!url || typeof url !== 'string') return false;
    if (this._activeUrls.has(url)) {
      if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        try {
          URL.revokeObjectURL(url);
        } catch (e) {
          console.warn('[MediaUrlManager] Error revoking URL:', e);
        }
      }
      this._activeUrls.delete(url);
      return true;
    }
    return false;
  }

  /**
   * Revokes all currently tracked Object URLs and clears the registry.
   *
   * @returns {number} Number of revoked URLs.
   */
  revokeAll() {
    let count = 0;
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      for (const url of this._activeUrls) {
        try {
          URL.revokeObjectURL(url);
          count++;
        } catch (e) {
          console.warn('[MediaUrlManager] Error revoking URL:', e);
        }
      }
    }
    this._activeUrls.clear();
    return count;
  }

  /**
   * Checks if an Object URL is currently tracked as active.
   *
   * @param {string} url
   * @returns {boolean}
   */
  has(url) {
    return this._activeUrls.has(url);
  }

  /**
   * Current number of active tracked URLs (getter property).
   * @returns {number}
   */
  get size() {
    return this._activeUrls.size;
  }

  /**
   * Current number of active tracked URLs (method contract for UI components).
   * @returns {number}
   */
  getActiveCount() {
    return this._activeUrls.size;
  }

  /**
   * Array copy of all currently active URLs (getter property).
   * @returns {string[]}
   */
  get activeUrls() {
    return Array.from(this._activeUrls);
  }

  /**
   * Array copy of all currently active URLs (method contract for UI components).
   * @returns {string[]}
   */
  getActiveUrls() {
    return Array.from(this._activeUrls);
  }

  /**
   * Clears and revokes all tracked URLs (alias for revokeAll).
   * @returns {number} Number of revoked URLs.
   */
  clear() {
    return this.revokeAll();
  }
}

/**
 * Constructs an inline-safe, cross-platform HTMLVideoElement configured with
 * WebKit and Blink safeguards (playsinline, webkit-playsinline, preload="metadata").
 * Supports iPhone .mov (video/quicktime) and Android .mp4 / .webm.
 *
 * @param {string} srcUrl - Object URL or stream URL for the video.
 * @param {string} [mimeType='video/mp4'] - MIME type of the video stream.
 * @param {string} [posterUrl=''] - Optional poster image URL.
 * @param {object} [options={}] - Additional configuration options.
 * @param {boolean} [options.controls=true] - Display native controls.
 * @param {string} [options.preload='metadata'] - Preload policy ('metadata' | 'none' | 'auto').
 * @param {boolean} [options.muted=false] - Mute audio.
 * @param {boolean} [options.autoplay=false] - Autoplay (forces muted=true per mobile policy).
 * @param {boolean} [options.loop=false] - Loop playback.
 * @param {string} [options.className='garment-fit-video'] - CSS class name.
 * @returns {HTMLVideoElement}
 */
export function createSafeVideoPlayer(srcUrl, mimeType = 'video/mp4', posterUrl = '', options = {}) {
  const {
    controls = true,
    preload = 'metadata',
    muted = false,
    autoplay = false,
    loop = false,
    className = 'garment-fit-video'
  } = options;

  if (typeof document === 'undefined') {
    throw new Error('createSafeVideoPlayer requires a DOM document environment');
  }

  const video = document.createElement('video');
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.setAttribute('preload', preload);

  if (controls) {
    video.setAttribute('controls', '');
    video.setAttribute('controlsList', 'nodownload noplaybackrate');
  }

  video.setAttribute('disablePictureInPicture', '');
  video.className = className;

  if (posterUrl) {
    video.poster = posterUrl;
  }

  // Mobile autoplay policy: unmuted autoplay is blocked by WebKit & Blink
  if (muted || autoplay) {
    video.muted = true;
  }
  if (autoplay) {
    video.autoplay = true;
  }
  if (loop) {
    video.loop = true;
  }

  if (srcUrl) {
    const source = document.createElement('source');
    source.src = srcUrl;
    source.type = mimeType || 'video/mp4';
    video.appendChild(source);

    const fallback = document.createElement('p');
    fallback.className = 'video-unsupported-msg';
    fallback.textContent = 'Your browser does not support inline video playback.';
    video.appendChild(fallback);
  }

  return video;
}

/**
 * Requests persistent storage from the browser (iOS Safari 17+ & Android Chrome)
 * so IndexedDB data is protected from automatic OS storage eviction.
 *
 * @returns {Promise<boolean>}
 */
export async function requestPersistentStorage() {
  try {
    if (
      typeof navigator !== 'undefined' &&
      navigator.storage &&
      typeof navigator.storage.persist === 'function'
    ) {
      const isPersisted =
        typeof navigator.storage.persisted === 'function'
          ? await navigator.storage.persisted()
          : false;
      if (isPersisted) return true;
      return await navigator.storage.persist();
    }
  } catch (_) {}
  return false;
}

