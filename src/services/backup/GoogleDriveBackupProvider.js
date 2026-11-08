/**
 * GoogleDriveBackupProvider - Pre-wired Adapter Stub for v2 Google Drive Auto-Sync
 * Implements the BackupProvider contract so v2 cloud sync can be enabled seamlessly.
 */

import { BackupProvider } from './BackupProvider.js';
import { wardrobeDb } from '../../db/wardrobeDb.js';

export class GoogleDriveBackupProvider extends BackupProvider {
  constructor(options = {}) {
    super();
    this.clientId = options.clientId || null;
    this.accessToken = options.accessToken || null;
    this.folderName = options.folderName || 'Wardrobe Organizer Backups';
  }

  get id() {
    return 'google_drive';
  }

  get name() {
    return 'Google Drive Cloud Backup';
  }

  get description() {
    return 'Automatic cloud sync of wardrobe.json, photos, and fit videos to your Google One / Google Drive storage (v2 adapter).';
  }

  async getStatus() {
    const dbStatus = await wardrobeDb.getBackupStatus().catch(() => ({
      lastBackupAt: null,
      hasUnsavedChanges: false,
      changesCount: 0
    }));

    return {
      providerId: this.id,
      providerName: this.name,
      requiresAuth: true,
      isAuthenticated: Boolean(this.accessToken),
      v2Ready: true,
      folderName: this.folderName,
      ...dbStatus
    };
  }

  async exportFullBackup(onProgress) {
    if (!this.accessToken) {
      throw new Error('GoogleDriveBackupProvider: OAuth2 authentication required for v2 direct cloud upload. Use LocalArchiveBackupProvider + Web Share to save directly to Google Drive in v1.');
    }
    throw new Error('GoogleDriveBackupProvider: v2 Google Drive API sync endpoint not yet configured.');
  }

  async exportMetadataJson() {
    if (!this.accessToken) {
      throw new Error('GoogleDriveBackupProvider: OAuth2 authentication required for v2 cloud snapshot sync.');
    }
    throw new Error('GoogleDriveBackupProvider: v2 Google Drive API sync endpoint not yet configured.');
  }

  async importBackup(fileOrPayload, mode = 'replace', onProgress) {
    if (!this.accessToken) {
      throw new Error('GoogleDriveBackupProvider: OAuth2 authentication required to restore directly from Google Drive API.');
    }
    throw new Error('GoogleDriveBackupProvider: v2 Google Drive API restore endpoint not yet configured.');
  }
}

export default GoogleDriveBackupProvider;
