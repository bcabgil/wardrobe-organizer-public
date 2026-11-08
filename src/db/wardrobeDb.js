/**
 * WardrobeDB - Browser-Native IndexedDB Storage Layer
 * Database Name: WardrobeDB
 * Version: 1
 * Stores: garments, media, settings, outfitHistory
 */

import { blobToArrayBuffer, arrayBufferToBlob } from '../utils/mediaUtils.js';

export const DB_NAME = 'WardrobeDB';
export const DB_VERSION = 1;

export const DEFAULT_SETTINGS = {
  activeSeason: 'winter',
  geminiApiKey: '',
  location: '',
  stylePreferences: '',
  lastBackupAt: null,
  preferredBackupProvider: 'local_archive',
  laundryCategories: ['coloured', 'whites'],
  careCategories: ['delicate', 'other'],
  occasionCategories: ['everyday', 'dress-up']
};

export function normalizeCategoryValue(label) {
  return String(label || '')
    .trim()
    .toLowerCase();
}

export function formatCategoryLabel(val) {
  if (Array.isArray(val)) {
    return val
      .map((item) => formatCategoryLabel(item))
      .filter(Boolean)
      .join(', ');
  }
  const raw = String(val || '').trim();
  const lower = raw.toLowerCase();
  const known = {
    coloured: 'Coloured',
    whites: 'Whites',
    delicate: 'Delicate',
    other: 'Other',
    regular: 'Other',
    everyday: 'Everyday',
    'dress-up': 'Dress-up',
    gym: 'Gym'
  };
  if (known[lower]) return known[lower];
  if (!raw) return '';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function getGarmentOccasionList(garment = {}) {
  const rawType = garment ? garment.type : null;
  if (Array.isArray(rawType)) {
    const list = Array.from(
      new Set(rawType.map((v) => normalizeCategoryValue(v)).filter(Boolean))
    );
    return list.length > 0 ? list : ['everyday'];
  }
  if (typeof rawType === 'string' && rawType.trim()) {
    const list = Array.from(
      new Set(
        rawType
          .split(',')
          .map((v) => normalizeCategoryValue(v))
          .filter(Boolean)
      )
    );
    return list.length > 0 ? list : ['everyday'];
  }
  return ['everyday'];
}

export function garmentMatchesOccasion(garment = {}, targetOccasion = 'everyday') {
  const normTarget = normalizeCategoryValue(targetOccasion || 'everyday') || 'everyday';
  return getGarmentOccasionList(garment).includes(normTarget);
}

export function getGarmentCareCategory(garment = {}) {
  if (garment && garment.careCategory && typeof garment.careCategory === 'string') {
    return garment.careCategory;
  }
  return garment && garment.delicate ? 'delicate' : 'other';
}

// Helper: Promisify IndexedDB Request
function promisifyRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });
}

// Helper: Generate UUID v4 or fallback
function generateUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function inferDefaultLayerRole(garment = {}) {
  if (garment.layerRole) return garment.layerRole;
  const cat = String(garment.category || 'top').toLowerCase();
  if (cat === 'outerwear') return 'outer';
  if (cat !== 'top') return 'single';
  const text = `${garment.name || ''} ${garment.visualDescription || ''}`.toLowerCase();
  if (/jumper|sweater|cardigan|hoodie|pullover|knit|fleece|sweatshirt|vest|turtleneck/i.test(text)) {
    return 'mid';
  }
  return 'base';
}

function inferDefaultTempSuitability(garment = {}) {
  if (garment.tempSuitability) return garment.tempSuitability;
  if (garment.season === 'winter') return 'cold';
  if (garment.season === 'summer') return 'warm';
  return 'all-temps';
}

export class WardrobeDB {
  constructor() {
    this._dbPromise = null;
  }

  /**
   * Open or retrieve active IndexedDB connection
   * @returns {Promise<IDBDatabase>}
   */
  async openDb() {
    if (this._dbPromise) {
      return this._dbPromise;
    }

    this._dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        return reject(new Error('IndexedDB is not supported in this environment'));
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // 1. garments store
        if (!db.objectStoreNames.contains('garments')) {
          const garmentStore = db.createObjectStore('garments', { keyPath: 'id' });
          garmentStore.createIndex('status_season', ['status', 'season'], { unique: false });
          garmentStore.createIndex('laundry_load', ['status', 'colorGroup', 'delicate'], { unique: false });
          garmentStore.createIndex('season', 'season', { unique: false });
          garmentStore.createIndex('category', 'category', { unique: false });
          garmentStore.createIndex('type', 'type', { unique: false });
          garmentStore.createIndex('status', 'status', { unique: false });
          garmentStore.createIndex('colorGroup', 'colorGroup', { unique: false });
          garmentStore.createIndex('delicate', 'delicate', { unique: false });
          garmentStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        }

        // 2. media store (keyPath is 'id')
        if (!db.objectStoreNames.contains('media')) {
          const mediaStore = db.createObjectStore('media', { keyPath: 'id' });
          mediaStore.createIndex('garmentId', 'garmentId', { unique: false });
          mediaStore.createIndex('type', 'type', { unique: false });
        }

        // 3. settings store
        if (!db.objectStoreNames.contains('settings')) {
          const settingsStore = db.createObjectStore('settings', { keyPath: 'key' });
          const now = new Date().toISOString();
          for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
            settingsStore.put({ key, value, updatedAt: now });
          }
        }

        // 4. outfitHistory store
        if (!db.objectStoreNames.contains('outfitHistory')) {
          const outfitStore = db.createObjectStore('outfitHistory', { keyPath: 'id', autoIncrement: true });
          outfitStore.createIndex('wornAt', 'wornAt', { unique: false });
          outfitStore.createIndex('outfitId', 'outfitId', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        const db = event.target.result;

        db.onversionchange = () => {
          db.close();
          this._dbPromise = null;
        };

        db.onclose = () => {
          this._dbPromise = null;
        };

        resolve(db);
      };

      request.onerror = (event) => {
        this._dbPromise = null;
        reject(event.target.error || new Error('Failed to open WardrobeDB'));
      };

      request.onblocked = () => {
        console.warn('[WardrobeDB] Database open blocked. Close other tabs running WardrobeDB.');
      };
    });

    return this._dbPromise;
  }

  /**
   * Alias for openDb
   */
  async getDatabase() {
    return this.openDb();
  }

  /**
   * Close database connection
   */
  closeDb() {
    if (this._dbPromise) {
      this._dbPromise.then((db) => {
        db.close();
      }).catch(() => {});
      this._dbPromise = null;
    }
  }

  /**
   * Clear all stores and reinitialize default settings
   */
  async clearDatabase() {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['garments', 'media', 'settings', 'outfitHistory'], 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));

      tx.objectStore('garments').clear();
      tx.objectStore('media').clear();
      tx.objectStore('outfitHistory').clear();

      const settingsStore = tx.objectStore('settings');
      settingsStore.clear();
      const now = new Date().toISOString();
      for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        settingsStore.put({ key, value, updatedAt: now });
      }
    });
  }

  // ==========================================
  // GARMENTS API
  // ==========================================

  /**
   * Save a garment along with optional photo and video blobs in an atomic transaction
   */
  async saveGarment(garment, photoBlob = null, videoBlob = null) {
    if (!garment) throw new Error('Garment data is required');

    const garmentId = garment.id || generateUUID();
    const now = new Date().toISOString();

    // Prepare media buffers before opening transaction
    let photoRecord = null;
    let videoRecord = null;

    if (photoBlob) {
      const data = await blobToArrayBuffer(photoBlob);
      const mediaId = garment.photoMediaId || `photo_${garmentId}_${Date.now()}`;
      const mimeType = photoBlob.type || 'image/jpeg';
      photoRecord = {
        id: mediaId,
        mediaId: mediaId,
        garmentId,
        type: 'photo',
        mimeType,
        data,
        size: data ? data.byteLength : 0,
        createdAt: now
      };
    }

    if (videoBlob) {
      const data = await blobToArrayBuffer(videoBlob);
      const mediaId = garment.videoMediaId || `video_${garmentId}_${Date.now()}`;
      const mimeType = videoBlob.type || 'video/mp4';
      videoRecord = {
        id: mediaId,
        mediaId: mediaId,
        garmentId,
        type: 'video',
        mimeType,
        data,
        size: data ? data.byteLength : 0,
        createdAt: now
      };
    }

    const careCategory =
      garment.careCategory ||
      (garment.delicate !== undefined ? (garment.delicate ? 'delicate' : 'other') : 'other');
    const isDelicate =
      garment.delicate !== undefined
        ? Boolean(garment.delicate)
        : String(careCategory).toLowerCase() === 'delicate';

    const garmentToSave = {
      id: garmentId,
      name: garment.name || 'Untitled Garment',
      category: garment.category || 'top',
      season: garment.season || 'all-season',
      colorGroup: garment.colorGroup || 'coloured',
      careCategory,
      delicate: isDelicate,
      status: garment.status || 'clean',
      type: garment.type || 'everyday',
      tempSuitability: inferDefaultTempSuitability(garment),
      layerRole: inferDefaultLayerRole(garment),
      visualDescription: garment.visualDescription || '',
      photoMediaId: photoRecord ? photoRecord.id : (garment.photoMediaId || null),
      videoMediaId: videoRecord ? videoRecord.id : (garment.videoMediaId || null),
      lastWornAt: garment.lastWornAt || null,
      createdAt: garment.createdAt || now,
      updatedAt: garment.updatedAt || now
    };

    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['garments', 'media'], 'readwrite');
      tx.oncomplete = () => resolve(garmentToSave);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Save transaction aborted'));

      const mediaStore = tx.objectStore('media');
      if (photoRecord) mediaStore.put(photoRecord);
      if (videoRecord) mediaStore.put(videoRecord);

      const garmentStore = tx.objectStore('garments');
      garmentStore.put(garmentToSave);
    });
  }

  /**
   * Alias for saveGarment
   */
  async addGarment(garment, photoBlob = null, videoBlob = null) {
    return this.saveGarment(garment, photoBlob, videoBlob);
  }

  /**
   * Get garment by ID
   */
  async getGarment(id) {
    if (!id) return null;
    const db = await this.openDb();
    const tx = db.transaction('garments', 'readonly');
    const store = tx.objectStore('garments');
    const garment = await promisifyRequest(store.get(id));
    return garment || null;
  }

  /**
   * Get all garments sorted by updatedAt desc
   */
  async getAllGarments() {
    const db = await this.openDb();
    const tx = db.transaction('garments', 'readonly');
    const store = tx.objectStore('garments');
    const items = await promisifyRequest(store.getAll());
    return (items || []).sort((a, b) => {
      const timeA = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const timeB = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return timeB - timeA;
    });
  }

  /**
   * Filter garments by attributes (supports season inheritance: winter/summer includes all-season)
   */
  async getGarmentsByFilter(filters = {}) {
    const all = await this.getAllGarments();
    return all.filter((item) => {
      if (filters.status && item.status !== filters.status) return false;
      if (filters.category && item.category !== filters.category) return false;
      if (filters.type && !garmentMatchesOccasion(item, filters.type)) return false;
      if (filters.colorGroup && item.colorGroup !== filters.colorGroup) return false;
      if (typeof filters.delicate === 'boolean' && Boolean(item.delicate) !== filters.delicate) return false;

      if (filters.season) {
        if (filters.season === 'winter') {
          if (item.season !== 'winter' && item.season !== 'all-season') return false;
        } else if (filters.season === 'summer') {
          if (item.season !== 'summer' && item.season !== 'all-season') return false;
        } else if (filters.season === 'all-season') {
          if (item.season !== 'all-season') return false;
        } else if (item.season !== filters.season) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Update garment metadata (supports updateGarment(garment) or updateGarment(id, updates))
   */
  async updateGarment(garmentOrId, updates = null) {
    let existing;
    if (typeof garmentOrId === 'string') {
      existing = await this.getGarment(garmentOrId);
      if (!existing) throw new Error(`Garment not found with ID: ${garmentOrId}`);
      if (updates && typeof updates === 'object') {
        Object.assign(existing, updates);
      }
    } else if (garmentOrId && typeof garmentOrId === 'object') {
      existing = garmentOrId;
      if (updates && typeof updates === 'object') {
        Object.assign(existing, updates);
      }
    } else {
      throw new Error('Invalid arguments to updateGarment');
    }

    if (updates && typeof updates === 'object') {
      if (updates.careCategory !== undefined && updates.delicate === undefined) {
        existing.delicate = String(updates.careCategory).toLowerCase() === 'delicate';
      } else if (updates.delicate !== undefined && updates.careCategory === undefined) {
        existing.careCategory = updates.delicate ? 'delicate' : 'other';
      }
    }
    if (!existing.careCategory) {
      existing.careCategory = existing.delicate ? 'delicate' : 'other';
    }
    existing.updatedAt = new Date().toISOString();

    const db = await this.openDb();
    const tx = db.transaction('garments', 'readwrite');
    const store = tx.objectStore('garments');
    await promisifyRequest(store.put(existing));
    return existing;
  }

  /**
   * Atomic cascading delete: removes garment and associated media files
   */
  async deleteGarment(id) {
    if (!id) return false;
    const db = await this.openDb();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(['garments', 'media'], 'readwrite');
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Delete transaction aborted'));

      const garmentStore = tx.objectStore('garments');
      const mediaStore = tx.objectStore('media');

      // Fetch garment first to delete specific media
      const getReq = garmentStore.get(id);
      getReq.onsuccess = () => {
        const garment = getReq.result;
        if (garment) {
          if (garment.photoMediaId) mediaStore.delete(garment.photoMediaId);
          if (garment.videoMediaId) mediaStore.delete(garment.videoMediaId);
        }

        // Also delete any media matching garmentId index
        const index = mediaStore.index('garmentId');
        const mediaReq = index.getAllKeys(id);
        mediaReq.onsuccess = () => {
          const keys = mediaReq.result || [];
          for (const key of keys) {
            mediaStore.delete(key);
          }
          garmentStore.delete(id);
        };
        mediaReq.onerror = () => {
          garmentStore.delete(id);
        };
      };
      getReq.onerror = () => {
        reject(getReq.error);
      };
    });
  }

  /**
   * Quick status toggle between 'clean' and 'to_wash'
   */
  async toggleGarmentStatus(id) {
    const garment = await this.getGarment(id);
    if (!garment) throw new Error(`Garment not found with ID: ${id}`);
    garment.status = garment.status === 'clean' ? 'to_wash' : 'clean';
    return await this.updateGarment(garment);
  }

  // ==========================================
  // MEDIA API
  // ==========================================

  /**
   * Save media record into 'media' store (converts Blob/File to ArrayBuffer)
   */
  async saveMedia(mediaData) {
    if (!mediaData) throw new Error('Media data is required');

    const buffer = await blobToArrayBuffer(mediaData.data);
    const key = mediaData.id || mediaData.mediaId || `${mediaData.type || 'photo'}_${mediaData.garmentId || 'asset'}_${Date.now()}_${generateUUID()}`;

    const record = {
      id: key,
      mediaId: key,
      garmentId: mediaData.garmentId || null,
      type: mediaData.type || 'photo',
      mimeType: mediaData.mimeType || 'application/octet-stream',
      data: buffer,
      size: buffer ? buffer.byteLength : (mediaData.size || 0),
      createdAt: mediaData.createdAt || new Date().toISOString()
    };

    const db = await this.openDb();
    const tx = db.transaction('media', 'readwrite');
    const store = tx.objectStore('media');
    await promisifyRequest(store.put(record));

    return record;
  }

  /**
   * Get raw media record by id or mediaId
   */
  async getMedia(mediaId) {
    if (!mediaId) return null;
    const db = await this.openDb();
    const tx = db.transaction('media', 'readonly');
    const store = tx.objectStore('media');
    const record = await promisifyRequest(store.get(mediaId));
    if (!record) return null;
    return { ...record, mediaId: record.id };
  }

  /**
   * Reconstruct Blob from ArrayBuffer & mimeType
   */
  async getMediaBlob(mediaId) {
    const record = await this.getMedia(mediaId);
    if (!record || !record.data) return null;
    return arrayBufferToBlob(record.data, record.mimeType);
  }

  /**
   * Delete media record by id
   */
  async deleteMedia(mediaId) {
    if (!mediaId) return false;
    const db = await this.openDb();
    const tx = db.transaction('media', 'readwrite');
    const store = tx.objectStore('media');
    await promisifyRequest(store.delete(mediaId));
    return true;
  }

  /**
   * Get all media records associated with a garment
   */
  async getMediaByGarmentId(garmentId) {
    if (!garmentId) return [];
    const db = await this.openDb();
    const tx = db.transaction('media', 'readonly');
    const store = tx.objectStore('media');
    const index = store.index('garmentId');
    const items = await promisifyRequest(index.getAll(garmentId));
    return (items || []).map((m) => ({ ...m, mediaId: m.id }));
  }

  /**
   * Delete media records not referenced by any existing garment
   */
  async cleanupOrphanedMedia() {
    const db = await this.openDb();
    const garments = await this.getAllGarments();
    const referencedIds = new Set();
    for (const g of garments) {
      if (g.photoMediaId) referencedIds.add(g.photoMediaId);
      if (g.videoMediaId) referencedIds.add(g.videoMediaId);
    }

    const tx = db.transaction('media', 'readwrite');
    const store = tx.objectStore('media');
    const allMedia = await promisifyRequest(store.getAll());
    let deletedCount = 0;

    for (const media of allMedia || []) {
      if (!referencedIds.has(media.id) && !referencedIds.has(media.mediaId)) {
        store.delete(media.id);
        deletedCount++;
      }
    }

    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    return deletedCount;
  }

  // ==========================================
  // LAUNDRY API
  // ==========================================

  /**
   * Get total number of garments currently in 'to_wash'
   */
  async getLaundryCount() {
    const garments = await this.getAllGarments();
    return garments.filter((g) => g.status === 'to_wash').length;
  }

  /**
   * Get garments segregated into 4 standard laundry loads:
   * whitesRegular, whitesDelicate, colouredRegular, colouredDelicate
   */
  async getLaundryLoads() {
    const garments = await this.getAllGarments();
    const dirty = garments.filter((g) => g.status === 'to_wash');

    const loads = {
      whitesRegular: [],
      whitesDelicate: [],
      colouredRegular: [],
      colouredDelicate: []
    };

    for (const item of dirty) {
      const isWhites = item.colorGroup === 'whites';
      const isDelicate = Boolean(item.delicate);

      if (isWhites && !isDelicate) {
        loads.whitesRegular.push(item);
      } else if (isWhites && isDelicate) {
        loads.whitesDelicate.push(item);
      } else if (!isWhites && !isDelicate) {
        loads.colouredRegular.push(item);
      } else {
        loads.colouredDelicate.push(item);
      }
    }

    return loads;
  }

  /**
   * Batch mark laundry load garments as 'clean'
   */
  async markLoadClean(garmentIds = []) {
    if (!garmentIds || garmentIds.length === 0) return 0;
    const now = new Date().toISOString();
    const db = await this.openDb();

    return new Promise((resolve, reject) => {
      const tx = db.transaction('garments', 'readwrite');
      const store = tx.objectStore('garments');
      let count = 0;

      for (const id of garmentIds) {
        const req = store.get(id);
        req.onsuccess = () => {
          const garment = req.result;
          if (garment) {
            garment.status = 'clean';
            garment.updatedAt = now;
            store.put(garment);
            count++;
          }
        };
      }

      tx.oncomplete = () => resolve(count);
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Alias for markLoadClean
   */
  async markGarmentsClean(garmentIds = []) {
    return this.markLoadClean(garmentIds);
  }

  /**
   * Mark garments as worn, move to 'to_wash' (unless markToWash is false), and update lastWornAt timestamp
   */
  async markGarmentsWorn(garmentIds = [], wornAt = null, markToWash = true) {
    if (!garmentIds || garmentIds.length === 0) return 0;
    const timestamp = wornAt || new Date().toISOString();
    const db = await this.openDb();

    return new Promise((resolve, reject) => {
      const tx = db.transaction('garments', 'readwrite');
      const store = tx.objectStore('garments');
      let count = 0;

      for (const id of garmentIds) {
        const req = store.get(id);
        req.onsuccess = () => {
          const garment = req.result;
          if (garment) {
            if (markToWash) {
              garment.status = 'to_wash';
            }
            garment.lastWornAt = timestamp;
            garment.updatedAt = timestamp;
            store.put(garment);
            count++;
          }
        };
      }

      tx.oncomplete = () => resolve(count);
      tx.onerror = () => reject(tx.error);
    });
  }

  // ==========================================
  // SETTINGS API
  // ==========================================

  /**
   * Get single setting value by key
   */
  async getSetting(key, defaultValue = null) {
    if (!key) return defaultValue;
    const db = await this.openDb();
    const tx = db.transaction('settings', 'readonly');
    const store = tx.objectStore('settings');
    const record = await promisifyRequest(store.get(key));
    if (!record) {
      return key in DEFAULT_SETTINGS ? DEFAULT_SETTINGS[key] : defaultValue;
    }
    return record.value !== undefined ? record.value : record;
  }

  /**
   * Set single setting value by key
   */
  async setSetting(key, value) {
    if (!key) throw new Error('Setting key is required');
    const db = await this.openDb();
    const tx = db.transaction('settings', 'readwrite');
    const store = tx.objectStore('settings');
    await promisifyRequest(store.put({
      key,
      value,
      updatedAt: new Date().toISOString()
    }));
  }

  /**
   * Get all settings as a key-value dictionary
   */
  async getSettings() {
    const db = await this.openDb();
    const tx = db.transaction('settings', 'readonly');
    const store = tx.objectStore('settings');
    const records = await promisifyRequest(store.getAll());

    const result = { ...DEFAULT_SETTINGS };
    for (const record of records || []) {
      result[record.key] = record.value;
    }
    return result;
  }

  /**
   * Get user-configurable category lists (laundryCategories, careCategories, occasionCategories)
   */
  async getCustomCategories() {
    const settings = await this.getSettings();
    const laundryCategories =
      Array.isArray(settings.laundryCategories) && settings.laundryCategories.length > 0
        ? settings.laundryCategories
        : [...DEFAULT_SETTINGS.laundryCategories];
    const careCategories =
      Array.isArray(settings.careCategories) && settings.careCategories.length > 0
        ? settings.careCategories
        : [...DEFAULT_SETTINGS.careCategories];
    const occasionCategories =
      Array.isArray(settings.occasionCategories) && settings.occasionCategories.length > 0
        ? settings.occasionCategories
        : [...DEFAULT_SETTINGS.occasionCategories];

    return { laundryCategories, careCategories, occasionCategories };
  }

  /**
   * Add a new category option to laundryCategories, careCategories, or occasionCategories
   */
  async addCategoryOption(groupKey, rawLabel) {
    const val = normalizeCategoryValue(rawLabel);
    if (!val) return null;
    const cats = await this.getCustomCategories();
    const list = Array.isArray(cats[groupKey]) ? [...cats[groupKey]] : [];
    if (!list.some((item) => normalizeCategoryValue(item) === val)) {
      list.push(val);
      await this.setSetting(groupKey, list);
    }
    return { list, value: val };
  }

  /**
   * Remove a category option from laundryCategories, careCategories, or occasionCategories.
   * Keeps at least 1 option in the group and reassigns any existing garments using the deleted
   * category to the first remaining option in that group.
   */
  async removeCategoryOption(groupKey, valueToRemove) {
    const val = normalizeCategoryValue(valueToRemove);
    const cats = await this.getCustomCategories();
    const currentList = Array.isArray(cats[groupKey]) ? cats[groupKey] : [];
    if (currentList.length <= 1) {
      return currentList;
    }
    const list = currentList.filter(
      (item) => normalizeCategoryValue(item) !== val
    );
    if (list.length === 0) {
      return currentList;
    }
    await this.setSetting(groupKey, list);

    const fallbackVal = normalizeCategoryValue(list[0]);
    if (fallbackVal) {
      const garments = await this.getAllGarments();
      const now = new Date().toISOString();
      const toUpdate = [];

      for (const g of garments) {
        if (!g) continue;
        if (groupKey === 'occasionCategories') {
          if (Array.isArray(g.type)) {
            const hasVal = g.type.some((t) => normalizeCategoryValue(t) === val);
            if (hasVal) {
              const filtered = g.type.filter((t) => normalizeCategoryValue(t) !== val);
              g.type = filtered.length > 0 ? filtered : [fallbackVal];
              g.updatedAt = now;
              toUpdate.push(g);
            }
          } else if (normalizeCategoryValue(g.type || 'everyday') === val) {
            g.type = fallbackVal;
            g.updatedAt = now;
            toUpdate.push(g);
          }
        } else if (groupKey === 'laundryCategories') {
          if (normalizeCategoryValue(g.colorGroup || 'coloured') === val) {
            g.colorGroup = fallbackVal;
            g.updatedAt = now;
            toUpdate.push(g);
          }
        } else if (groupKey === 'careCategories') {
          if (normalizeCategoryValue(getGarmentCareCategory(g)) === val) {
            g.careCategory = fallbackVal;
            g.delicate = fallbackVal === 'delicate';
            g.updatedAt = now;
            toUpdate.push(g);
          }
        }
      }

      if (toUpdate.length > 0) {
        const db = await this.openDb();
        await new Promise((resolve, reject) => {
          const tx = db.transaction('garments', 'readwrite');
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error || new Error('Category reassignment transaction aborted'));
          const store = tx.objectStore('garments');
          for (const item of toUpdate) {
            store.put(item);
          }
        });
      }
    }

    return list;
  }

  /**
   * Update multiple settings
   */
  async updateSettings(settingsObj = {}) {
    if (!settingsObj || typeof settingsObj !== 'object') return;
    const db = await this.openDb();
    const tx = db.transaction('settings', 'readwrite');
    const store = tx.objectStore('settings');
    const now = new Date().toISOString();

    for (const [key, value] of Object.entries(settingsObj)) {
      store.put({ key, value, updatedAt: now });
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ==========================================
  // DIRTY-TRACKING & BACKUP STATUS
  // ==========================================

  /**
   * Check if changes have occurred since last successful backup
   * Compares garments.updatedAt / createdAt against settings.lastBackupAt
   */
  async hasChangesSinceBackup() {
    const garments = await this.getAllGarments();
    if (!garments || garments.length === 0) {
      return false;
    }

    const lastBackupAt = await this.getSetting('lastBackupAt', null);
    if (!lastBackupAt) {
      return true;
    }

    const backupTime = new Date(lastBackupAt).getTime();
    if (isNaN(backupTime)) {
      return true;
    }

    return garments.some((g) => {
      const itemTime = new Date(g.updatedAt || g.createdAt || 0).getTime();
      return itemTime > backupTime;
    });
  }

  /**
   * Get detailed backup status and storage metrics
   */
  async getBackupStatus() {
    const garments = await this.getAllGarments();
    const lastBackupAt = await this.getSetting('lastBackupAt', null);
    const backupTime = lastBackupAt ? new Date(lastBackupAt).getTime() : 0;

    let changesCount = 0;
    if (!lastBackupAt) {
      changesCount = garments.length;
    } else {
      for (const g of garments) {
        const itemTime = new Date(g.updatedAt || g.createdAt || 0).getTime();
        if (itemTime > backupTime) changesCount++;
      }
    }

    let totalPhotos = garments.filter((g) => Boolean(g && g.photoMediaId)).length;
    let totalVideos = garments.filter((g) => Boolean(g && g.videoMediaId)).length;
    let estimatedStorageBytes = 0;

    try {
      const db = await this.openDb();
      const mediaTx = db.transaction('media', 'readonly');
      const mediaStore = mediaTx.objectStore('media');
      if (mediaStore.indexNames && mediaStore.indexNames.contains('type')) {
        const typeIndex = mediaStore.index('type');
        const [pCount, vCount] = await Promise.all([
          promisifyRequest(typeIndex.count('photo')).catch(() => totalPhotos),
          promisifyRequest(typeIndex.count('video')).catch(() => totalVideos)
        ]);
        if (typeof pCount === 'number') totalPhotos = pCount;
        if (typeof vCount === 'number') totalVideos = vCount;
      }
    } catch (_) {}

    try {
      if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.estimate === 'function') {
        const est = await navigator.storage.estimate();
        if (est && typeof est.usage === 'number') {
          estimatedStorageBytes = est.usage;
        }
      }
    } catch (_) {}

    return {
      lastBackupAt,
      hasUnsavedChanges: changesCount > 0,
      changesCount,
      totalGarments: garments.length,
      totalPhotos,
      totalVideos,
      estimatedStorageBytes
    };
  }

  // ==========================================
  // OUTFIT HISTORY API
  // ==========================================

  /**
   * Build canonical sorted combination signature from garment IDs
   */
  getCombinationKey(garmentIds = []) {
    return Array.from(new Set((garmentIds || []).filter(Boolean)))
      .sort()
      .join('|');
  }

  /**
   * Save outfit history log (autoIncrement ID)
   */
  async addOutfitHistory(outfit = {}) {
    const garmentIds = Array.isArray(outfit.garmentIds) ? outfit.garmentIds : [];
    const record = {
      outfitId: outfit.outfitId || outfit.id || generateUUID(),
      title: outfit.title || 'Stylist Outfit',
      garmentIds,
      combinationKey: this.getCombinationKey(garmentIds),
      wornAt: outfit.wornAt || outfit.date || new Date().toISOString(),
      explanation: outfit.explanation || '',
      layeringTips: outfit.layeringTips || '',
      occasion: outfit.occasion || '',
      weatherSnapshot: outfit.weatherSnapshot || null,
      worn: outfit.worn !== undefined ? Boolean(outfit.worn) : true
    };

    const db = await this.openDb();
    const tx = db.transaction('outfitHistory', 'readwrite');
    const store = tx.objectStore('outfitHistory');
    const generatedId = await promisifyRequest(store.add(record));
    return { ...record, id: generatedId };
  }

  /**
   * Get wear count dictionary mapped by canonical combinationKey (sorted garmentIds joined by '|')
   * @returns {Promise<Record<string, number>>}
   */
  async getCombinationWearCounts() {
    const db = await this.openDb();
    const tx = db.transaction('outfitHistory', 'readonly');
    const store = tx.objectStore('outfitHistory');
    const records = await promisifyRequest(store.getAll());
    const counts = {};

    for (const r of records || []) {
      if (r && r.worn !== false && Array.isArray(r.garmentIds) && r.garmentIds.length > 0) {
        const key = r.combinationKey || this.getCombinationKey(r.garmentIds);
        if (key) {
          counts[key] = (counts[key] || 0) + 1;
        }
      }
    }

    return counts;
  }

  /**
   * Alias for addOutfitHistory
   */
  async saveOutfitHistory(outfit) {
    return this.addOutfitHistory(outfit);
  }

  /**
   * Get outfit history sorted by wornAt desc
   */
  async getOutfitHistory(limit = 50) {
    const db = await this.openDb();
    const tx = db.transaction('outfitHistory', 'readonly');
    const store = tx.objectStore('outfitHistory');
    const records = await promisifyRequest(store.getAll());
    return (records || [])
      .sort((a, b) => new Date(b.wornAt || 0).getTime() - new Date(a.wornAt || 0).getTime())
      .slice(0, limit);
  }

  /**
   * Delete outfit history record by ID
   */
  async deleteOutfitHistory(id) {
    if (!id && id !== 0) return false;
    const db = await this.openDb();
    const tx = db.transaction('outfitHistory', 'readwrite');
    const store = tx.objectStore('outfitHistory');
    await promisifyRequest(store.delete(id));
    return true;
  }
}

// Singleton instance
export const wardrobeDb = new WardrobeDB();

// Bound method exports for direct destructuring or module-level invocation
export const openDb = wardrobeDb.openDb.bind(wardrobeDb);
export const getDatabase = wardrobeDb.openDb.bind(wardrobeDb);
export const closeDb = wardrobeDb.closeDb.bind(wardrobeDb);
export const clearDatabase = wardrobeDb.clearDatabase.bind(wardrobeDb);
export const saveGarment = wardrobeDb.saveGarment.bind(wardrobeDb);
export const addGarment = wardrobeDb.addGarment.bind(wardrobeDb);
export const getGarment = wardrobeDb.getGarment.bind(wardrobeDb);
export const getAllGarments = wardrobeDb.getAllGarments.bind(wardrobeDb);
export const getGarmentsByFilter = wardrobeDb.getGarmentsByFilter.bind(wardrobeDb);
export const updateGarment = wardrobeDb.updateGarment.bind(wardrobeDb);
export const deleteGarment = wardrobeDb.deleteGarment.bind(wardrobeDb);
export const toggleGarmentStatus = wardrobeDb.toggleGarmentStatus.bind(wardrobeDb);
export const saveMedia = wardrobeDb.saveMedia.bind(wardrobeDb);
export const getMedia = wardrobeDb.getMedia.bind(wardrobeDb);
export const getMediaBlob = wardrobeDb.getMediaBlob.bind(wardrobeDb);
export const deleteMedia = wardrobeDb.deleteMedia.bind(wardrobeDb);
export const getMediaByGarmentId = wardrobeDb.getMediaByGarmentId.bind(wardrobeDb);
export const cleanupOrphanedMedia = wardrobeDb.cleanupOrphanedMedia.bind(wardrobeDb);
export const getLaundryCount = wardrobeDb.getLaundryCount.bind(wardrobeDb);
export const getLaundryLoads = wardrobeDb.getLaundryLoads.bind(wardrobeDb);
export const markLoadClean = wardrobeDb.markLoadClean.bind(wardrobeDb);
export const markGarmentsClean = wardrobeDb.markGarmentsClean.bind(wardrobeDb);
export const markGarmentsWorn = wardrobeDb.markGarmentsWorn.bind(wardrobeDb);
export const getSetting = wardrobeDb.getSetting.bind(wardrobeDb);
export const setSetting = wardrobeDb.setSetting.bind(wardrobeDb);
export const getSettings = wardrobeDb.getSettings.bind(wardrobeDb);
export const updateSettings = wardrobeDb.updateSettings.bind(wardrobeDb);
export const hasChangesSinceBackup = wardrobeDb.hasChangesSinceBackup.bind(wardrobeDb);
export const getBackupStatus = wardrobeDb.getBackupStatus.bind(wardrobeDb);
export const addOutfitHistory = wardrobeDb.addOutfitHistory.bind(wardrobeDb);
export const saveOutfitHistory = wardrobeDb.saveOutfitHistory.bind(wardrobeDb);
export const getOutfitHistory = wardrobeDb.getOutfitHistory.bind(wardrobeDb);
export const deleteOutfitHistory = wardrobeDb.deleteOutfitHistory.bind(wardrobeDb);
export const getCombinationKey = wardrobeDb.getCombinationKey.bind(wardrobeDb);
export const getCombinationWearCounts = wardrobeDb.getCombinationWearCounts.bind(wardrobeDb);

export default wardrobeDb;
