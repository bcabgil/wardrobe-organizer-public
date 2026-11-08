/**
 * BackupProvider - Abstract Base Contract for Pluggable Wardrobe Backup Providers
 */

export class BackupProvider {
  get id() {
    throw new Error('Abstract getter "id" must be implemented by BackupProvider subclass');
  }

  get name() {
    throw new Error('Abstract getter "name" must be implemented by BackupProvider subclass');
  }

  get description() {
    throw new Error('Abstract getter "description" must be implemented by BackupProvider subclass');
  }

  /**
   * Export full backup containing wardrobe.json + photos/ + videos/
   * @param {Function} [onProgress] - (percent: number, stepLabel: string) => void
   * @returns {Promise<{ blob: Blob, filename: string, timestamp: string }>}
   */
  async exportFullBackup(onProgress) {
    throw new Error('Abstract method "exportFullBackup" must be implemented by BackupProvider subclass');
  }

  /**
   * Export lightweight metadata & status snapshot (.json)
   * @returns {Promise<{ blob: Blob, jsonString: string, filename: string, timestamp: string }>}
   */
  async exportMetadataJson() {
    throw new Error('Abstract method "exportMetadataJson" must be implemented by BackupProvider subclass');
  }

  /**
   * Import and restore a backup (.zip Blob/File or .json string/Blob/File)
   * @param {Blob|File|string|ArrayBuffer|Object} fileOrPayload
   * @param {'replace'|'merge'} [mode='replace']
   * @param {Function} [onProgress]
   * @returns {Promise<{ success: boolean, garmentsCount: number, mediaCount: number, mode: string }>}
   */
  async importBackup(fileOrPayload, mode = 'replace', onProgress) {
    throw new Error('Abstract method "importBackup" must be implemented by BackupProvider subclass');
  }

  /**
   * Retrieve current backup status and metrics
   * @returns {Promise<Object>}
   */
  async getStatus() {
    throw new Error('Abstract method "getStatus" must be implemented by BackupProvider subclass');
  }
}

export default BackupProvider;
