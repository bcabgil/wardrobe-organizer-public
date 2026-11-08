/**
 * LocalArchiveBackupProvider - Full Offline .zip and Quick .json Backup & Restore Engine
 * Bundles manifest.json, wardrobe.json, photos/, and videos/ using vendored JSZip.
 */

import { BackupProvider } from './BackupProvider.js';
import { wardrobeDb, DEFAULT_SETTINGS, normalizeCategoryValue } from '../../db/wardrobeDb.js';
import { blobToArrayBuffer } from '../../utils/mediaUtils.js';
import { eventBus } from '../../utils/eventBus.js';
import JSZip, { calculateCrc32 } from '../../vendor/jszip.min.js?v=28';

function getExtensionFromMime(mimeType = '') {
  const mime = String(mimeType).toLowerCase();
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('heic')) return 'heic';
  if (mime.includes('quicktime') || mime.includes('mov')) return 'mov';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('mp4')) return 'mp4';
  if (mime.startsWith('video/')) return 'mp4';
  return 'jpg';
}

function getMimeFromExtension(filename = '', fallbackType = 'photo') {
  const lower = String(filename).toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.heic')) return 'image/heic';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  return fallbackType === 'video' ? 'video/mp4' : 'image/jpeg';
}

function formatDateStamp(isoDate = new Date().toISOString()) {
  return isoDate.slice(0, 10);
}

function yieldToMainThread() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Normalize legacy garment records from any previous version of the app (v1 - v22+)
 */
export function normalizeLegacyGarment(incoming = {}, resolvedPhotoId = null, resolvedVideoId = null, now = new Date().toISOString()) {
  const rawCategory = String(incoming.category || 'top').trim().toLowerCase();
  const categoryMap = {
    top: 'top',
    tops: 'top',
    shirt: 'top',
     sweater: 'top',
    bottom: 'bottom',
    bottoms: 'bottom',
    pants: 'bottom',
    trousers: 'bottom',
    skirt: 'bottom',
    outerwear: 'outerwear',
    coat: 'outerwear',
    jacket: 'outerwear',
    coats: 'outerwear',
    jackets: 'outerwear',
    shoes: 'shoes',
    shoe: 'shoes',
    footwear: 'shoes',
    'one-piece': 'one-piece',
    onepiece: 'one-piece',
    dress: 'one-piece',
    dresses: 'one-piece',
    jumpsuit: 'one-piece',
    accessory: 'accessory',
    accessories: 'accessory'
  };
  const category = categoryMap[rawCategory] || 'top';

  const rawSeason = String(incoming.season || 'all-season').trim().toLowerCase();
  const season =
    rawSeason === 'winter' || rawSeason === 'summer' || rawSeason === 'all-season'
      ? rawSeason
      : 'all-season';

  const rawStatus = String(incoming.status || 'clean').trim().toLowerCase();
  const status =
    rawStatus === 'to_wash' || rawStatus === 'dirty' || rawStatus === 'wash' || rawStatus === 'laundry'
      ? 'to_wash'
      : 'clean';

  const rawColorGroup = normalizeCategoryValue(
    incoming.colorGroup || incoming.laundryCategory || incoming.color || 'coloured'
  );
  const colorGroup = rawColorGroup || 'coloured';

  const rawCare = normalizeCategoryValue(
    incoming.careCategory ||
      (incoming.delicate !== undefined ? (incoming.delicate ? 'delicate' : 'other') : 'other')
  );
  const careCategory = rawCare === 'regular' ? 'other' : (rawCare || 'other');
  const isDelicate =
    incoming.delicate !== undefined
      ? Boolean(incoming.delicate)
      : careCategory === 'delicate';

  const typeMap = {
    casual: 'everyday',
    daily: 'everyday',
    formal: 'dress-up',
    special: 'dress-up',
    party: 'dress-up',
    dressup: 'dress-up'
  };
  let type = 'everyday';
  const rawTypeSource = incoming.type !== undefined ? incoming.type : incoming.occasion;
  if (Array.isArray(rawTypeSource)) {
    const mapped = Array.from(
      new Set(
        rawTypeSource
          .map((item) => {
            const norm = normalizeCategoryValue(item);
            return typeMap[norm] || norm;
          })
          .filter(Boolean)
      )
    );
    type = mapped.length > 0 ? mapped : ['everyday'];
  } else {
    const rawType = normalizeCategoryValue(rawTypeSource || 'everyday');
    type = typeMap[rawType] || rawType || 'everyday';
  }

  let tempSuitability = incoming.tempSuitability;
  if (Array.isArray(tempSuitability)) {
    tempSuitability = tempSuitability.map((t) => String(t).toLowerCase()).filter(Boolean);
    if (tempSuitability.length === 0) {
      tempSuitability = season === 'winter' ? ['cold'] : season === 'summer' ? ['warm'] : ['cold', 'mild', 'warm'];
    }
  } else if (typeof tempSuitability === 'string' && tempSuitability.trim()) {
    tempSuitability = tempSuitability.trim().toLowerCase();
  } else {
    tempSuitability = season === 'winter' ? 'cold' : season === 'summer' ? 'warm' : 'all-temps';
  }

  let layerRole = incoming.layerRole;
  if (!layerRole || typeof layerRole !== 'string') {
    if (category === 'outerwear') {
      layerRole = 'outer';
    } else if (category !== 'top') {
      layerRole = 'single';
    } else {
      const text = `${incoming.name || ''} ${incoming.visualDescription || ''}`.toLowerCase();
      layerRole = /jumper|sweater|cardigan|hoodie|pullover|knit|fleece|sweatshirt|vest|turtleneck/i.test(text)
        ? 'mid'
        : 'base';
    }
  }

  return {
    id: String(incoming.id),
    name: incoming.name || incoming.title || 'Untitled Garment',
    category,
    season,
    colorGroup,
    careCategory,
    delicate: isDelicate,
    status,
    type,
    tempSuitability,
    layerRole,
    userDetails: incoming.userDetails || '',
    visualDescription: incoming.visualDescription || incoming.description || incoming.notes || '',
    photoMediaId: resolvedPhotoId || null,
    videoMediaId: resolvedVideoId || null,
    lastWornAt: incoming.lastWornAt || null,
    createdAt: incoming.createdAt || now,
    updatedAt: incoming.updatedAt || incoming.createdAt || now
  };
}

/**
 * Encode binary ArrayBuffer / TypedArray into an ASCII Base64 string in safe chunks
 */
export function arrayBufferToBase64Ascii(buffer) {
  if (!buffer) return '';
  if (typeof buffer === 'string') {
    return buffer.replace(/^data:[^;]+;base64,/i, '').replace(/\s+/g, '');
  }

  let bytes;
  if (buffer instanceof Uint8Array) {
    bytes = buffer;
  } else if (ArrayBuffer.isView(buffer)) {
    bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  } else if (
    buffer instanceof ArrayBuffer ||
    Object.prototype.toString.call(buffer) === '[object ArrayBuffer]' ||
    typeof buffer.byteLength === 'number'
  ) {
    bytes = new Uint8Array(buffer);
  } else {
    bytes = new Uint8Array(0);
  }

  if (bytes.byteLength === 0) return '';

  const chunkSize = 0x8000; // 32KB chunks to avoid call-stack overflow on large videos
  const chunks = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    chunks.push(String.fromCharCode.apply(null, slice));
  }
  return btoa(chunks.join(''));
}

/**
 * Decode an ASCII Base64 string (with optional data URI prefix) back into an ArrayBuffer
 */
export function base64AsciiToArrayBuffer(base64String) {
  if (!base64String || typeof base64String !== 'string') {
    return new ArrayBuffer(0);
  }
  const cleanBase64 = base64String
    .replace(/^data:[^;]+;base64,/i, '')
    .replace(/\s+/g, '');
  if (!cleanBase64) return new ArrayBuffer(0);

  const binaryStr = atob(cleanBase64);
  const len = binaryStr.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return bytes.buffer;
}

export class LocalArchiveBackupProvider extends BackupProvider {
  get id() {
    return 'local_archive';
  }

  get name() {
    return 'Local Archive (.zip / .json)';
  }

  get description() {
    return 'Portable offline ZIP archive (wardrobe.json + photos + fit videos) and lightweight JSON status snapshots.';
  }

  async getStatus() {
    const dbStatus = await wardrobeDb.getBackupStatus();
    return {
      providerId: this.id,
      providerName: this.name,
      requiresAuth: false,
      ...dbStatus
    };
  }

  /**
   * Retrieve all media primary keys without loading binary ArrayBuffers into RAM at once
   */
  async _getAllMediaKeys(db) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('media', 'readonly');
      const store = tx.objectStore('media');
      if (typeof store.getAllKeys === 'function') {
        const req = store.getAllKeys();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      } else {
        const keys = [];
        const cursorReq = store.openKeyCursor ? store.openKeyCursor() : store.openCursor();
        cursorReq.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            keys.push(cursor.key);
            cursor.continue();
          } else {
            resolve(keys);
          }
        };
        cursorReq.onerror = () => reject(cursorReq.error);
      }
    });
  }

  /**
   * Retrieve a single media record by primary key so only 1 photo/video is in RAM at a time
   */
  async _getMediaRecordById(db, mediaKey) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('media', 'readonly');
      const store = tx.objectStore('media');
      const req = store.get(mediaKey);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Collect lightweight metadata snapshot (garments, settings, outfitHistory, and media keys)
   */
  async _collectLightweightMetadata() {
    const db = await wardrobeDb.openDb();
    const [garments, settings, outfitHistory, mediaKeys] = await Promise.all([
      wardrobeDb.getAllGarments(),
      wardrobeDb.getSettings(),
      wardrobeDb.getOutfitHistory(1000),
      this._getAllMediaKeys(db)
    ]);

    // Strip sensitive geminiApiKey from exported backup files so keys never leak in shared .zip/.json files
    const safeSettings = { ...settings, geminiApiKey: '' };

    return {
      db,
      garments,
      settings: safeSettings,
      outfitHistory,
      mediaKeys
    };
  }

  /**
   * Export JSON backup snapshot (.json) including photos & fit videos encoded as ASCII Base64 strings.
   * Uses streaming Blob chunks when media is large so iOS Safari never crashes with Out-Of-Memory.
   */
  async exportMetadataJson(onProgress) {
    const notify = typeof onProgress === 'function' ? onProgress : () => {};
    notify(5, 'Reading wardrobe metadata...');

    const now = new Date().toISOString();
    const { db, garments, settings, outfitHistory, mediaKeys } = await this._collectLightweightMetadata();

    const mediaMetadata = [];
    const mediaBase64ByGarment = new Map();
    let totalMediaBytes = 0;

    for (let i = 0; i < mediaKeys.length; i++) {
      const m = await this._getMediaRecordById(db, mediaKeys[i]);
      if (!m || !m.id) continue;

      let binaryData = m.data;
      if (binaryData && typeof Blob !== 'undefined' && binaryData instanceof Blob) {
        binaryData = await blobToArrayBuffer(binaryData).catch(() => null);
      }

      const byteLen = binaryData ? binaryData.byteLength || 0 : (m.size || 0);
      totalMediaBytes += byteLen;

      const ext = getExtensionFromMime(m.mimeType);
      const folder = m.type === 'video' ? 'videos' : 'photos';
      const archivePath = `${folder}/${m.id}.${ext}`;
      const mimeType = m.mimeType || (m.type === 'video' ? 'video/mp4' : 'image/jpeg');
      const dataBase64 = binaryData ? arrayBufferToBase64Ascii(binaryData) : '';

      mediaMetadata.push({
        id: m.id,
        garmentId: m.garmentId,
        type: m.type || 'photo',
        mimeType,
        size: byteLen,
        createdAt: m.createdAt || now,
        archivePath,
        encoding: 'base64_ascii',
        dataBase64
      });

      // Only duplicate inline garment Base64 when total media payload is small (<8MB) to prevent doubling RAM on large wardrobes
      if (totalMediaBytes < 8 * 1024 * 1024 && m.garmentId && dataBase64) {
        const entry = mediaBase64ByGarment.get(m.garmentId) || {};
        if (m.type === 'video') {
          entry.videoDataBase64 = dataBase64;
          entry.videoMimeType = mimeType;
        } else {
          entry.photoDataBase64 = dataBase64;
          entry.photoMimeType = mimeType;
        }
        mediaBase64ByGarment.set(m.garmentId, entry);
      }

      binaryData = null;
      m.data = null;

      if (i % 3 === 2) {
        await yieldToMainThread();
      }
      const pct = 10 + Math.round(((i + 1) / Math.max(1, mediaKeys.length)) * 75);
      notify(pct, `Encoding media (${i + 1}/${mediaKeys.length})...`);
    }

    const garmentsOut =
      totalMediaBytes < 8 * 1024 * 1024
        ? garments.map((g) => {
            const fb = mediaBase64ByGarment.get(g.id);
            if (!fb) return g;
            return {
              ...g,
              ...(fb.photoDataBase64 ? { photoDataBase64: fb.photoDataBase64, photoMimeType: fb.photoMimeType } : {}),
              ...(fb.videoDataBase64 ? { videoDataBase64: fb.videoDataBase64, videoMimeType: fb.videoMimeType } : {})
            };
          })
        : garments;

    const filename = `wardrobe-status-${formatDateStamp(now)}.json`;
    let blob;
    let jsonString = '';

    // For small payloads (<12MB), build standard formatted jsonString; for larger payloads, stream into Blob chunks to avoid JSC string OOM
    if (totalMediaBytes < 12 * 1024 * 1024) {
      const payload = {
        version: 1,
        app: 'WardrobeOrganizerPWA',
        exportType: 'metadata_json',
        exportedAt: now,
        settings: {
          ...settings,
          lastBackupAt: now
        },
        garments: garmentsOut,
        mediaMetadata,
        outfitHistory
      };
      jsonString = JSON.stringify(payload, null, 2);
      blob = new Blob([jsonString], { type: 'application/json' });
    } else {
      const blobParts = [];
      blobParts.push(
        `{\n  "version": 1,\n  "app": "WardrobeOrganizerPWA",\n  "exportType": "metadata_json",\n  "exportedAt": ${JSON.stringify(now)},\n  "settings": ${JSON.stringify({ ...settings, lastBackupAt: now })},\n  "garments": ${JSON.stringify(garmentsOut)},\n  "outfitHistory": ${JSON.stringify(outfitHistory)},\n  "mediaMetadata": [\n`
      );
      for (let i = 0; i < mediaMetadata.length; i++) {
        const prefix = i === 0 ? '    ' : ',\n    ';
        blobParts.push(prefix + JSON.stringify(mediaMetadata[i]));
        mediaMetadata[i].dataBase64 = '';
      }
      blobParts.push('\n  ]\n}');
      blob = new Blob(blobParts, { type: 'application/json' });
    }

    await wardrobeDb.setSetting('lastBackupAt', now);
    notify(100, 'JSON backup complete');

    eventBus.emit('backup:completed', {
      type: 'json',
      timestamp: now,
      count: garments.length,
      mediaCount: mediaMetadata.length
    });

    return {
      blob,
      jsonString,
      filename,
      timestamp: now,
      count: garments.length,
      mediaCount: mediaMetadata.length
    };
  }

  /**
   * Export full .zip archive containing manifest.json, wardrobe.json, photos/, and videos/
   * Streams 1 media record at a time into Blob parts so peak memory stays <20MB even with 36+ garments and fit videos.
   */
  async exportFullBackup(onProgress) {
    const notify = typeof onProgress === 'function' ? onProgress : () => {};
    notify(5, 'Reading wardrobe database...');

    const now = new Date().toISOString();
    const { db, garments, settings, outfitHistory, mediaKeys } = await this._collectLightweightMetadata();

    const zip = new JSZip();
    const photosFolder = zip.folder('photos');
    const videosFolder = zip.folder('videos');

    const mediaMetadata = [];
    const totalMedia = mediaKeys.length;

    for (let i = 0; i < totalMedia; i++) {
      let m = null;
      try {
        m = await this._getMediaRecordById(db, mediaKeys[i]);
      } catch (_) {
        m = await wardrobeDb.getMedia(mediaKeys[i]).catch(() => null);
      }
      if (!m || !m.id) continue;

      let binaryData = m.data;
      if (binaryData && typeof Blob !== 'undefined' && binaryData instanceof Blob) {
        binaryData = await blobToArrayBuffer(binaryData).catch(() => null);
      }

      let dataBytes;
      if (binaryData instanceof Uint8Array) {
        dataBytes = binaryData;
      } else if (ArrayBuffer.isView(binaryData)) {
        dataBytes = new Uint8Array(binaryData.buffer, binaryData.byteOffset, binaryData.byteLength);
      } else if (
        binaryData &&
        (binaryData instanceof ArrayBuffer ||
          Object.prototype.toString.call(binaryData) === '[object ArrayBuffer]' ||
          typeof binaryData.byteLength === 'number')
      ) {
        dataBytes = new Uint8Array(binaryData);
      } else {
        dataBytes = new Uint8Array(0);
      }

      const byteLen = dataBytes.byteLength;
      const crc = calculateCrc32(dataBytes);
      const mimeType = m.mimeType || (m.type === 'video' ? 'video/mp4' : 'image/jpeg');
      const ext = getExtensionFromMime(mimeType);
      const folderName = m.type === 'video' ? 'videos' : 'photos';
      const fileName = `${m.id}.${ext}`;
      const archivePath = `${folderName}/${fileName}`;

      mediaMetadata.push({
        id: m.id,
        garmentId: m.garmentId,
        type: m.type || 'photo',
        mimeType,
        size: byteLen,
        createdAt: m.createdAt || now,
        archivePath
      });

      // Move bytes out of JS ArrayBuffer heap into a raw binary Blob slice so JSC GC frees the ArrayBuffer immediately
      const partBlob = new Blob([dataBytes]);
      const targetFolder = m.type === 'video' ? videosFolder : photosFolder;
      targetFolder.file(fileName, partBlob, {
        compression: 'STORE',
        crc32: crc,
        uncompressedSize: byteLen
      });

      // Immediately release JS ArrayBuffer references and yield 15ms so iOS WebKit GC frees RAM before reading next video
      dataBytes = null;
      binaryData = null;
      m.data = null;
      m = null;

      await new Promise((resolve) => setTimeout(resolve, 15));

      const pct = 15 + Math.round(((i + 1) / Math.max(1, totalMedia)) * 65);
      notify(pct, `Packaging media (${i + 1}/${totalMedia})...`);
    }

    const manifest = {
      version: 1,
      app: 'WardrobeOrganizerPWA',
      exportType: 'full_zip',
      exportedAt: now,
      counts: {
        garments: garments.length,
        media: mediaMetadata.length,
        outfitHistory: outfitHistory.length
      }
    };

    const wardrobePayload = {
      version: 1,
      exportedAt: now,
      settings: {
        ...settings,
        lastBackupAt: now
      },
      garments,
      mediaMetadata,
      outfitHistory
    };

    notify(85, 'Packaging wardrobe metadata...');
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));
    zip.file('wardrobe.json', JSON.stringify(wardrobePayload, null, 2));

    notify(92, 'Building ZIP archive...');
    const blob = await zip.generateAsync({
      type: 'blob',
      mimeType: 'application/zip'
    });

    const filename = `wardrobe-backup-${formatDateStamp(now)}.zip`;
    await wardrobeDb.setSetting('lastBackupAt', now);
    notify(100, 'Backup complete');

    eventBus.emit('backup:completed', {
      type: 'zip',
      timestamp: now,
      count: garments.length,
      mediaCount: mediaMetadata.length
    });

    return {
      blob,
      filename,
      timestamp: now,
      count: garments.length,
      mediaCount: mediaMetadata.length
    };
  }

  /**
   * Locate a ZIP entry by exact path or fallback to any file matching the mediaId inside photos/ or videos/
   */
  _findZipMediaEntry(loadedZip, meta = {}) {
    if (!loadedZip || !meta || !meta.id) return null;
    const ext = getExtensionFromMime(meta.mimeType);
    const folder = meta.type === 'video' ? 'videos' : 'photos';

    const candidates = [
      meta.archivePath,
      `${folder}/${meta.id}.${ext}`,
      `photos/${meta.id}.${ext}`,
      `videos/${meta.id}.${ext}`
    ].filter(Boolean);

    for (const path of candidates) {
      const entry = loadedZip.file(path);
      if (entry && !entry.dir) return entry;
    }

    // Fallback: search loadedZip.files for any entry whose basename starts with `${meta.id}.` or equals `${meta.id}`
    const idPrefix = `${String(meta.id).toLowerCase()}.`;
    const idExact = String(meta.id).toLowerCase();
    for (const [entryPath, entryObj] of Object.entries(loadedZip.files || {})) {
      if (!entryObj || entryObj.dir) continue;
      const base = entryPath.split('/').pop().toLowerCase();
      if (base === idExact || base.startsWith(idPrefix)) {
        return entryObj;
      }
    }
    return null;
  }

  /**
   * Import and restore either a .zip archive or a .json snapshot in 'replace' or 'merge' mode.
   * Backward-compatible with all previous versions of Wardrobe Organizer (v1 - v22+).
   */
  async importBackup(fileOrPayload, mode = 'replace', onProgress) {
    if (!fileOrPayload) {
      throw new Error('LocalArchiveBackupProvider.importBackup: Backup payload is required');
    }

    const restoreMode = mode === 'merge' ? 'merge' : 'replace';
    const notify = typeof onProgress === 'function' ? onProgress : () => {};
    notify(10, 'Inspecting backup payload...');

    let parsedData = null;
    let loadedZip = null;

    // 1. Parse payload (supports JSON string, plain Object, Legacy Garment Array, .json File/Blob, or .zip File/Blob)
    if (typeof fileOrPayload === 'string') {
      try {
        parsedData = JSON.parse(fileOrPayload);
      } catch (err) {
        throw new Error(`Invalid JSON backup string: ${err.message}`);
      }
    } else if (
      typeof fileOrPayload === 'object' &&
      !(fileOrPayload instanceof Blob) &&
      !(fileOrPayload instanceof ArrayBuffer) &&
      !ArrayBuffer.isView(fileOrPayload)
    ) {
      parsedData = fileOrPayload;
    } else {
      // Inspect magic bytes if Blob/File to distinguish PKZIP (0x50 0x4B 0x03 0x04) vs JSON ('{' or '[') reliably on mobile
      let looksLikeZip = false;
      let looksLikeJson = false;

      if (fileOrPayload instanceof Blob) {
        const headerSlice = await fileOrPayload.slice(0, 64).arrayBuffer();
        const headerBytes = new Uint8Array(headerSlice);
        if (
          headerBytes.length >= 4 &&
          headerBytes[0] === 0x50 &&
          headerBytes[1] === 0x4b &&
          (headerBytes[2] === 0x03 || headerBytes[2] === 0x05)
        ) {
          looksLikeZip = true;
        } else {
          const headerText = new TextDecoder('utf-8').decode(headerBytes).trimStart();
          if (headerText.startsWith('{') || headerText.startsWith('[')) {
            looksLikeJson = true;
          }
        }
      }

      const hasJsonExtension =
        fileOrPayload instanceof Blob &&
        !looksLikeZip &&
        (looksLikeJson ||
          fileOrPayload.type === 'application/json' ||
          (fileOrPayload.name && fileOrPayload.name.toLowerCase().endsWith('.json')));

      if (hasJsonExtension) {
        const text = await fileOrPayload.text();
        try {
          parsedData = JSON.parse(text);
        } catch (err) {
          throw new Error(`Invalid JSON backup file: ${err.message}`);
        }
      } else {
        try {
          loadedZip = await JSZip.loadAsync(fileOrPayload);
          // Support wardrobe.json or legacy backup.json / data.json at root or inside a subfolder
          let wardrobeEntry =
            loadedZip.file('wardrobe.json') ||
            loadedZip.file('backup.json') ||
            loadedZip.file('data.json');

          if (!wardrobeEntry) {
            const jsonMatches = loadedZip.filter(
              (relPath, entry) =>
                !entry.dir &&
                (relPath.endsWith('/wardrobe.json') ||
                  (relPath.endsWith('.json') && !relPath.endsWith('manifest.json')))
            );
            if (jsonMatches.length > 0) {
              wardrobeEntry = jsonMatches[0];
            }
          }

          if (!wardrobeEntry) {
            throw new Error('ZIP archive is missing required wardrobe.json');
          }
          const jsonText = await wardrobeEntry.async('string');
          wardrobeEntry.releaseMemory();
          parsedData = JSON.parse(jsonText);
        } catch (zipErr) {
          if (fileOrPayload instanceof Blob && !looksLikeZip) {
            try {
              const maybeText = await fileOrPayload.text();
              const trimmed = maybeText.trimStart();
              if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                parsedData = JSON.parse(maybeText);
              } else {
                throw zipErr;
              }
            } catch (_) {
              throw new Error(`Corrupted or unsupported backup archive: ${zipErr.message}`);
            }
          } else {
            throw new Error(`Corrupted or unsupported backup archive: ${zipErr.message}`);
          }
        }
      }
    }

    // Normalize legacy top-level backup structures (e.g. bare array of garments or { items: [...] } or { data: { garments: [...] } })
    if (Array.isArray(parsedData)) {
      parsedData = { version: 1, garments: parsedData, mediaMetadata: [], settings: {}, outfitHistory: [] };
    } else if (parsedData && typeof parsedData === 'object') {
      if (!Array.isArray(parsedData.garments)) {
        if (Array.isArray(parsedData.items)) {
          parsedData.garments = parsedData.items;
        } else if (Array.isArray(parsedData.wardrobe)) {
          parsedData.garments = parsedData.wardrobe;
        } else if (parsedData.data && Array.isArray(parsedData.data.garments)) {
          parsedData = { ...parsedData.data, ...parsedData, garments: parsedData.data.garments };
        }
      }
      if (!Array.isArray(parsedData.mediaMetadata) && Array.isArray(parsedData.media)) {
        parsedData.mediaMetadata = parsedData.media;
      }
    }

    if (!parsedData || typeof parsedData !== 'object' || !Array.isArray(parsedData.garments)) {
      throw new Error('Malformed backup payload: missing garments array');
    }

    notify(25, `Restoring wardrobe (${restoreMode} mode)...`);

    const existingSettings = await wardrobeDb.getSettings();
    const now = new Date().toISOString();
    const mediaMetadata = Array.isArray(parsedData.mediaMetadata) ? parsedData.mediaMetadata : [];
    const incomingGarments = parsedData.garments || [];
    const hasEmbeddedMediaPayload =
      Boolean(loadedZip) ||
      mediaMetadata.some(
        (m) =>
          m &&
          ((typeof m.dataBase64 === 'string' && m.dataBase64.length > 0) ||
            (typeof m.data === 'string' && m.data.length > 0))
      ) ||
      incomingGarments.some(
        (g) =>
          g &&
          ((typeof g.photoDataBase64 === 'string' && g.photoDataBase64.length > 0) ||
            (typeof g.photoBase64 === 'string' && g.photoBase64.length > 0) ||
            (typeof g.videoDataBase64 === 'string' && g.videoDataBase64.length > 0) ||
            (typeof g.videoBase64 === 'string' && g.videoBase64.length > 0))
      );

    if (restoreMode === 'replace') {
      if (hasEmbeddedMediaPayload) {
        await wardrobeDb.clearDatabase();
      } else {
        // Legacy metadata-only JSON without embedded media: clear garments/history but preserve existing local media blobs!
        const db = await wardrobeDb.openDb();
        await new Promise((resolve, reject) => {
          const tx = db.transaction(['garments', 'outfitHistory'], 'readwrite');
          tx.objectStore('garments').clear();
          tx.objectStore('outfitHistory').clear();
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      }
    }

    // 2. Restore Media Blobs (streaming 1 by 1 from ZIP archive OR Base64 ASCII strings)
    let restoredMediaCount = 0;
    const restoredMediaByGarment = new Map();
    const restoredMediaIds = new Set();
    const db = await wardrobeDb.openDb();

    if (mediaMetadata.length > 0) {
      for (let i = 0; i < mediaMetadata.length; i++) {
        const meta = mediaMetadata[i];
        const mediaId = meta && (meta.id || meta.mediaId);
        if (!meta || !mediaId) continue;

        let arrayBuffer = null;

        if (loadedZip) {
          const zipEntry = this._findZipMediaEntry(loadedZip, { ...meta, id: mediaId });
          if (zipEntry) {
            arrayBuffer = await zipEntry.async('arraybuffer');
            zipEntry.releaseMemory();
          }
        }

        const base64Source = meta.dataBase64 || (typeof meta.data === 'string' ? meta.data : '');
        if (!arrayBuffer && typeof base64Source === 'string' && base64Source.length > 0) {
          arrayBuffer = base64AsciiToArrayBuffer(base64Source);
          // Free large Base64 string immediately after decoding
          meta.dataBase64 = null;
          if (typeof meta.data === 'string') meta.data = null;
        }

        if (arrayBuffer && arrayBuffer.byteLength > 0) {
          const resolvedType =
            meta.type || (String(meta.mimeType || '').startsWith('video/') ? 'video' : 'photo');
          const resolvedMime =
            meta.mimeType || (resolvedType === 'video' ? 'video/mp4' : 'image/jpeg');

          await new Promise((resolve, reject) => {
            const tx = db.transaction('media', 'readwrite');
            const store = tx.objectStore('media');
            store.put({
              id: mediaId,
              mediaId,
              garmentId: meta.garmentId || null,
              type: resolvedType,
              mimeType: resolvedMime,
              data: arrayBuffer,
              size: arrayBuffer.byteLength,
              createdAt: meta.createdAt || now
            });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          });

          restoredMediaIds.add(mediaId);
          if (meta.garmentId) {
            const entry = restoredMediaByGarment.get(meta.garmentId) || {};
            if (resolvedType === 'video') {
              entry.videoMediaId = mediaId;
            } else {
              entry.photoMediaId = mediaId;
            }
            restoredMediaByGarment.set(meta.garmentId, entry);
          }
          restoredMediaCount++;
        }

        arrayBuffer = null;
        if (i % 3 === 2) {
          await yieldToMainThread();
        }
        const pct = 30 + Math.round(((i + 1) / Math.max(1, mediaMetadata.length)) * 45);
        notify(pct, `Restoring media (${i + 1}/${mediaMetadata.length})...`);
      }
    }

    // Legacy ZIP fallback: if a ZIP contains files in photos/ or videos/ that were not listed in mediaMetadata, restore them too
    if (loadedZip) {
      for (const [entryPath, zipEntry] of Object.entries(loadedZip.files || {})) {
        if (!zipEntry || zipEntry.dir) continue;
        const normalizedPath = entryPath.replace(/\\/g, '/');
        const isPhotoEntry = normalizedPath.startsWith('photos/');
        const isVideoEntry = normalizedPath.startsWith('videos/');
        if (!isPhotoEntry && !isVideoEntry) continue;

        const fileName = normalizedPath.split('/').pop();
        const dotIdx = fileName.lastIndexOf('.');
        const inferredId = dotIdx > 0 ? fileName.slice(0, dotIdx) : fileName;
        if (!inferredId || restoredMediaIds.has(inferredId)) continue;

        const arrayBuffer = await zipEntry.async('arraybuffer');
        zipEntry.releaseMemory();
        if (arrayBuffer && arrayBuffer.byteLength > 0) {
          const mediaType = isVideoEntry ? 'video' : 'photo';
          const mimeType = getMimeFromExtension(fileName, mediaType);
          await new Promise((resolve, reject) => {
            const tx = db.transaction('media', 'readwrite');
            const store = tx.objectStore('media');
            store.put({
              id: inferredId,
              mediaId: inferredId,
              garmentId: null,
              type: mediaType,
              mimeType,
              data: arrayBuffer,
              size: arrayBuffer.byteLength,
              createdAt: now
            });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          });
          restoredMediaIds.add(inferredId);
          restoredMediaCount++;
        }
      }
    }

    // 3. Restore Garments (with backward-compatible schema normalization & custom category collection)
    let restoredGarmentsCount = 0;
    const discoveredLaundryCats = new Set(DEFAULT_SETTINGS.laundryCategories);
    const discoveredCareCats = new Set(DEFAULT_SETTINGS.careCategories);
    const discoveredOccasionCats = new Set(DEFAULT_SETTINGS.occasionCategories);

    for (let i = 0; i < incomingGarments.length; i++) {
      const incoming = incomingGarments[i];
      if (!incoming || (!incoming.id && !incoming.name)) continue;
      if (!incoming.id) {
        incoming.id = `garment_restored_${Date.now()}_${i}`;
      }

      let resolvedPhotoId =
        incoming.photoMediaId || incoming.photoId || restoredMediaByGarment.get(incoming.id)?.photoMediaId || null;
      let resolvedVideoId =
        incoming.videoMediaId || incoming.videoId || restoredMediaByGarment.get(incoming.id)?.videoMediaId || null;

      // Inline Base64 photo fallback (supports photoDataBase64, photoBase64, imageData)
      const inlinePhotoB64 = incoming.photoDataBase64 || incoming.photoBase64 || incoming.imageData;
      if (typeof inlinePhotoB64 === 'string' && inlinePhotoB64.length > 0) {
        const pId = resolvedPhotoId || `photo_${incoming.id}_${Date.now()}`;
        resolvedPhotoId = pId;
        if (!restoredMediaIds.has(pId)) {
          const existingMedia = await wardrobeDb.getMedia(pId);
          if (!existingMedia) {
            const buf = base64AsciiToArrayBuffer(inlinePhotoB64);
            if (buf && buf.byteLength > 0) {
              await wardrobeDb.saveMedia({
                id: pId,
                garmentId: incoming.id,
                type: 'photo',
                mimeType: incoming.photoMimeType || 'image/jpeg',
                data: buf
              });
              restoredMediaIds.add(pId);
              restoredMediaCount++;
            }
          }
        }
        incoming.photoDataBase64 = null;
        incoming.photoBase64 = null;
        incoming.imageData = null;
      }

      // Inline Base64 video fallback (supports videoDataBase64, videoBase64)
      const inlineVideoB64 = incoming.videoDataBase64 || incoming.videoBase64;
      if (typeof inlineVideoB64 === 'string' && inlineVideoB64.length > 0) {
        const vId = resolvedVideoId || `video_${incoming.id}_${Date.now()}`;
        resolvedVideoId = vId;
        if (!restoredMediaIds.has(vId)) {
          const existingMedia = await wardrobeDb.getMedia(vId);
          if (!existingMedia) {
            const buf = base64AsciiToArrayBuffer(inlineVideoB64);
            if (buf && buf.byteLength > 0) {
              await wardrobeDb.saveMedia({
                id: vId,
                garmentId: incoming.id,
                type: 'video',
                mimeType: incoming.videoMimeType || 'video/mp4',
                data: buf
              });
              restoredMediaIds.add(vId);
              restoredMediaCount++;
            }
          }
        }
        incoming.videoDataBase64 = null;
        incoming.videoBase64 = null;
      }

      const normalizedGarment = normalizeLegacyGarment(incoming, resolvedPhotoId, resolvedVideoId, now);

      if (normalizedGarment.colorGroup) discoveredLaundryCats.add(normalizedGarment.colorGroup);
      if (normalizedGarment.careCategory) discoveredCareCats.add(normalizedGarment.careCategory);
      if (Array.isArray(normalizedGarment.type)) {
        for (const t of normalizedGarment.type) {
          if (t) discoveredOccasionCats.add(t);
        }
      } else if (normalizedGarment.type) {
        discoveredOccasionCats.add(normalizedGarment.type);
      }

      if (restoreMode === 'merge') {
        const existing = await wardrobeDb.getGarment(normalizedGarment.id);
        if (existing) {
          const existingTime = new Date(existing.updatedAt || existing.createdAt || 0).getTime();
          const incomingTime = new Date(normalizedGarment.updatedAt || normalizedGarment.createdAt || 0).getTime();
          if (incomingTime >= existingTime) {
            await new Promise((resolve, reject) => {
              const tx = db.transaction('garments', 'readwrite');
              tx.objectStore('garments').put({
                ...existing,
                ...normalizedGarment,
                photoMediaId: normalizedGarment.photoMediaId || existing.photoMediaId || null,
                videoMediaId: normalizedGarment.videoMediaId || existing.videoMediaId || null
              });
              tx.oncomplete = () => resolve();
              tx.onerror = () => reject(tx.error);
            });
            restoredGarmentsCount++;
          }
          continue;
        }
      }

      await new Promise((resolve, reject) => {
        const tx = db.transaction('garments', 'readwrite');
        tx.objectStore('garments').put(normalizedGarment);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      restoredGarmentsCount++;
    }

    // 4. Restore Settings (preserving API key and merging any custom categories from legacy or current backups)
    const incomingSettings = parsedData.settings || {};
    const mergedSettings = { ...incomingSettings };

    if (
      (!incomingSettings.geminiApiKey || String(incomingSettings.geminiApiKey).trim() === '') &&
      existingSettings.geminiApiKey
    ) {
      mergedSettings.geminiApiKey = existingSettings.geminiApiKey;
    }

    const mergeCategoryList = (existingList = [], incomingList = [], discoveredSet = new Set()) => {
      const combined = new Set();
      for (const item of existingList || []) {
        const v = normalizeCategoryValue(item);
        if (v) combined.add(v);
      }
      for (const item of incomingList || []) {
        const v = normalizeCategoryValue(item);
        if (v) combined.add(v);
      }
      for (const item of discoveredSet) {
        const v = normalizeCategoryValue(item);
        if (v) combined.add(v);
      }
      return Array.from(combined);
    };

    mergedSettings.laundryCategories = mergeCategoryList(
      restoreMode === 'merge' ? existingSettings.laundryCategories : DEFAULT_SETTINGS.laundryCategories,
      incomingSettings.laundryCategories,
      discoveredLaundryCats
    );
    mergedSettings.careCategories = mergeCategoryList(
      restoreMode === 'merge' ? existingSettings.careCategories : DEFAULT_SETTINGS.careCategories,
      incomingSettings.careCategories,
      discoveredCareCats
    );
    mergedSettings.occasionCategories = mergeCategoryList(
      restoreMode === 'merge' ? existingSettings.occasionCategories : DEFAULT_SETTINGS.occasionCategories,
      incomingSettings.occasionCategories,
      discoveredOccasionCats
    );

    mergedSettings.lastBackupAt = now;
    await wardrobeDb.updateSettings(mergedSettings);

    // 5. Restore Outfit History (both in replace mode and non-duplicates in merge mode)
    const incomingHistory = Array.isArray(parsedData.outfitHistory) ? parsedData.outfitHistory : [];
    if (incomingHistory.length > 0) {
      if (restoreMode === 'replace') {
        for (const h of incomingHistory) {
          if (h && typeof h === 'object') {
            await wardrobeDb.addOutfitHistory(h);
          }
        }
      } else {
        const existingHistory = await wardrobeDb.getOutfitHistory(1000);
        const existingSignatures = new Set(
          existingHistory.map((eh) => `${eh.outfitId || ''}_${eh.wornAt || ''}`)
        );
        for (const h of incomingHistory) {
          if (!h || typeof h !== 'object') continue;
          const sig = `${h.outfitId || ''}_${h.wornAt || ''}`;
          if (!existingSignatures.has(sig)) {
            await wardrobeDb.addOutfitHistory(h);
            existingSignatures.add(sig);
          }
        }
      }
    }

    notify(100, 'Restore complete');

    eventBus.emit('backup:restored', {
      mode: restoreMode,
      garmentsCount: restoredGarmentsCount,
      mediaCount: restoredMediaCount
    });
    eventBus.emit('wardrobe:changed', { source: 'backup_restore' });
    eventBus.emit('laundry:updated', { source: 'backup_restore' });

    return {
      success: true,
      mode: restoreMode,
      count: restoredGarmentsCount,
      garmentsCount: restoredGarmentsCount,
      mediaCount: restoredMediaCount
    };
  }
}

export default LocalArchiveBackupProvider;
