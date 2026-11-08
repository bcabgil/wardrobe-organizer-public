/**
 * BackupManager - Coordinates Pluggable Backup Providers & Native Mobile File Delivery
 * Supports iOS Safari / Android Chrome Web Share API (Save to Files / Google Drive / AirDrop)
 * with automatic <a download> fallback.
 */

import { LocalArchiveBackupProvider } from './LocalArchiveBackupProvider.js?v=28';
import { GoogleDriveBackupProvider } from './GoogleDriveBackupProvider.js';

/**
 * Deliver a generated backup Blob via Native Mobile Share Sheet (if supported) or <a download>
 * @param {Object} options
 * @param {Blob} options.blob
 * @param {string} options.filename
 * @param {string} [options.mimeType]
 * @param {boolean} [options.preferDownload=false]
 * @returns {Promise<{ success: boolean, method: 'share'|'download', aborted?: boolean }>}
 */
export async function deliverBackupFile({
  blob,
  filename,
  mimeType = 'application/octet-stream',
  preferDownload = false
} = {}) {
  if (!blob || !(blob instanceof Blob)) {
    throw new Error('deliverBackupFile: Valid Blob is required');
  }

  const safeFilename = filename || `wardrobe-backup-${new Date().toISOString().slice(0, 10)}.zip`;
  const effectiveMime = mimeType || blob.type || 'application/octet-stream';

  // 1. Attempt Web Share API Level 2 (native iOS/Android Share sheet -> Save to Files / Google Drive)
  if (
    !preferDownload &&
    typeof navigator !== 'undefined' &&
    typeof navigator.canShare === 'function' &&
    typeof navigator.share === 'function' &&
    typeof File !== 'undefined'
  ) {
    try {
      const file = new File([blob], safeFilename, { type: effectiveMime });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'Wardrobe Organizer Backup',
          text: `Wardrobe backup (${safeFilename})`
        });
        return { success: true, method: 'share', filename: safeFilename };
      }
    } catch (err) {
      if (err && (err.name === 'AbortError' || /abort|cancel|dismiss/i.test(err.message || ''))) {
        return { success: false, aborted: true, method: 'share', filename: safeFilename };
      }
      // If share failed for another reason (e.g. desktop browser restriction), fall through to <a download>
    }
  }

  // 2. Fallback to standard <a download> (saves to device's Downloads folder)
  if (typeof document !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    let objectUrl = null;
    try {
      objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = safeFilename;
      anchor.rel = 'noopener';
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
    } catch (_) {
      // Ignore DOM download click restrictions; caller also provides direct 1-tap Save/Share UI
    } finally {
      if (objectUrl) {
        setTimeout(() => {
          try {
            URL.revokeObjectURL(objectUrl);
          } catch (_) {}
        }, 300000);
      }
    }
  }

  return { success: true, method: 'download', filename: safeFilename };
}

export class BackupManager {
  constructor() {
    this.providers = new Map();
    this.registerProvider(new LocalArchiveBackupProvider());
    this.registerProvider(new GoogleDriveBackupProvider());
    this.activeProviderId = 'local_archive';
  }

  registerProvider(provider) {
    if (!provider || !provider.id) {
      throw new Error('BackupManager.registerProvider: Invalid provider');
    }
    this.providers.set(provider.id, provider);
  }

  getProvider(id = this.activeProviderId) {
    return this.providers.get(id) || this.providers.get('local_archive');
  }

  setActiveProvider(id) {
    if (!this.providers.has(id)) {
      throw new Error(`Unknown backup provider: ${id}`);
    }
    this.activeProviderId = id;
    return this.getProvider(id);
  }

  listProviders() {
    return Array.from(this.providers.values()).map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description
    }));
  }

  async exportAndDeliverFullBackup({ onProgress, preferDownload = false } = {}) {
    const provider = this.getProvider();
    const res = await provider.exportFullBackup(onProgress);
    const delivery = await deliverBackupFile({
      blob: res.blob,
      filename: res.filename,
      mimeType: 'application/zip',
      preferDownload
    });
    return { ...res, delivery };
  }

  async exportAndDeliverMetadataJson({ onProgress, preferDownload = false } = {}) {
    const provider = this.getProvider();
    const res = await provider.exportMetadataJson(onProgress);
    const delivery = await deliverBackupFile({
      blob: res.blob,
      filename: res.filename,
      mimeType: 'application/json',
      preferDownload
    });
    return { ...res, delivery };
  }

  async importBackup(fileOrPayload, mode = 'replace', onProgress) {
    const provider = this.getProvider();
    return provider.importBackup(fileOrPayload, mode, onProgress);
  }

  async getStatus() {
    const provider = this.getProvider();
    return provider.getStatus();
  }
}

export const backupManager = new BackupManager();
export default backupManager;
