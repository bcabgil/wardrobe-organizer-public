/**
 * BackupSettingsView.js - Preferences-First Settings & Compact Wardrobe Backup Vault
 */

import { wardrobeDb } from '../db/wardrobeDb.js';
import { backupManager, deliverBackupFile } from '../services/backup/BackupManager.js?v=28';
import { testGeminiApiKey } from '../services/ai/geminiService.js';
import { eventBus } from '../utils/eventBus.js';
import { escapeHtml, formatBytes, formatRelativeDate } from '../utils/domUtils.js';
import { showToast } from '../components/Toast.js';
import { LoadingOverlay } from '../components/LoadingOverlay.js';

export class BackupSettingsView {
  constructor() {
    this.container = null;
    this.settings = {};
    this.backupStatus = {};
    this.isAdvancedOpen = false;
    this.lastExportedBackup = null;
  }

  async mount(container) {
    this.container = container;
    this.render();
    await this.loadState();
    if (this.settings.stylePreferences && String(this.settings.stylePreferences).trim().length > 0) {
      this.isAdvancedOpen = true;
    }
    this.render();
  }

  async loadState() {
    const [settings, status] = await Promise.all([
      wardrobeDb.getSettings().catch(() => ({
        activeSeason: 'winter',
        location: '',
        geminiApiKey: '',
        stylePreferences: ''
      })),
      backupManager.getStatus().catch(() => ({
        lastBackupAt: null,
        hasUnsavedChanges: false,
        changesCount: 0,
        totalGarments: 0,
        totalPhotos: 0,
        totalVideos: 0,
        estimatedStorageBytes: 0
      }))
    ]);
    this.settings = settings || {};
    this.backupStatus = status || {};
  }

  render() {
    if (!this.container) return;

    const s = this.settings;
    const b = this.backupStatus;
    const hasKey = Boolean(s.geminiApiKey && String(s.geminiApiKey).trim().length > 5);
    const hasStylePrefs = Boolean(s.stylePreferences && String(s.stylePreferences).trim().length > 0);
    const showAdvanced = this.isAdvancedOpen || hasStylePrefs;

    this.container.innerHTML = `
      <section class="view-section settings-view">
        <div class="section-header">
          <h2>Settings</h2>
        </div>

        <!-- 1. PREFERENCES & AI STYLIST CARD -->
        <div class="card-surface settings-card">
          <div class="settings-card-header">
            <h3>Preferences &amp; AI Stylist</h3>
            <button
              type="button"
              id="btn-toggle-advanced-settings"
              class="toolbar-tonal-btn ${showAdvanced ? 'active' : ''}"
            >
              Advanced Settings +
            </button>
          </div>
          <form id="settings-form" class="garment-form">
            <div class="form-row-2 keep-2col-mobile">
              <label class="form-label">ACTIVE SEASON
                <select name="activeSeason" class="form-select">
                  <option value="winter" ${s.activeSeason === 'winter' ? 'selected' : ''}>Winter Mode</option>
                  <option value="summer" ${s.activeSeason === 'summer' ? 'selected' : ''}>Summer Mode</option>
                </select>
              </label>

              <label class="form-label">CITY (WEATHER)
                <input type="text" name="location" class="form-input" placeholder="e.g., Madrid, London" value="${escapeHtml(s.location || '')}" />
              </label>
            </div>

            <div class="form-group">
              <div class="form-label-row">
                <label class="form-label" for="gemini-key-input">GEMINI API KEY</label>
                ${
                  hasKey
                    ? '<span class="key-status-ok" style="font-size:0.74rem;">✓ Configured</span>'
                    : '<span class="key-status-missing" style="font-size:0.74rem;">Optional</span>'
                }
              </div>
              <div style="display:flex; gap:8px;">
                <input
                  type="password"
                  id="gemini-key-input"
                  name="geminiApiKey"
                  class="form-input"
                  placeholder="AIzaSy... key from aistudio.google.com"
                  value="${escapeHtml(s.geminiApiKey || '')}"
                  autocomplete="off"
                />
                <button type="button" id="btn-test-gemini-key" class="btn-secondary" style="white-space:nowrap;">Test</button>
              </div>
              <p class="form-help">
                Free key via
                <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" style="color:var(--text-primary); font-weight:600;">Google AI Studio</a>.
                Stored locally on your device.
              </p>
            </div>

            <div id="advanced-settings-drawer" class="stylist-options-drawer ${showAdvanced ? '' : 'hidden'}">
              <div class="form-group">
                <div class="form-label-row">
                  <label class="form-label" for="style-preferences-input">STYLING PREFERENCES</label>
                  ${
                    hasStylePrefs
                      ? '<span class="key-status-ok" style="font-size:0.74rem;">✓ Active</span>'
                      : '<span class="key-status-missing" style="font-size:0.74rem;">Optional</span>'
                  }
                </div>
                <textarea
                  id="style-preferences-input"
                  name="stylePreferences"
                  class="form-textarea"
                  rows="3"
                  placeholder="e.g., Prefer minimalist neutral palettes, French-tucked jumpers, relaxed silhouettes, and avoid pairing navy with black..."
                >${escapeHtml(s.stylePreferences || '')}</textarea>
                <p class="form-help">
                  Injected directly into the AI Stylist system prompt when creating outfit combinations.
                </p>
              </div>
            </div>

            <button type="submit" class="btn-primary btn-block">Save Settings</button>
          </form>
        </div>

        <!-- 2. COMPACT WARDROBE BACKUP VAULT CARD -->
        <div class="card-surface settings-card">
          <div class="settings-card-header">
            <h3>Backup Vault</h3>
            <span class="backup-health-pill ${b.hasUnsavedChanges ? 'is-dirty' : 'is-synced'}">
              ${b.hasUnsavedChanges ? `${b.changesCount || 1} Unsaved` : '✓ Backed Up'}
            </span>
          </div>

          <p class="backup-summary-line">
            ${b.totalGarments || 0} Garments  ·  ${b.totalPhotos || 0} Photos  ·  ${b.totalVideos || 0} Videos  ·  ${formatBytes(b.estimatedStorageBytes || 0)}
          </p>
          <p class="backup-meta-line">Last Backup: <strong>${escapeHtml(formatRelativeDate(b.lastBackupAt))}</strong></p>

          <div class="backup-actions-grid">
            <button type="button" id="btn-export-zip" class="btn-primary">
              EXPORT .ZIP
            </button>

            <button type="button" id="btn-export-json" class="btn-secondary">
              EXPORT .JSON
            </button>
          </div>

          ${
            this.lastExportedBackup
              ? `
            <div id="backup-ready-banner" class="backup-ready-banner" style="padding:14px; border:1.5px solid var(--text-primary); background:var(--bg-elevated); display:flex; flex-direction:column; gap:8px;">
              <div style="font-size:0.86rem; font-weight:600; color:var(--text-primary);">
                ✓ ${this.lastExportedBackup.savedLocation ? 'Backup Saved' : 'Backup Created & Ready'}: ${escapeHtml(this.lastExportedBackup.filename)} (${formatBytes(this.lastExportedBackup.size || 0)})
              </div>
              <p class="form-help" style="margin:0; color:var(--text-primary);">
                ${
                  this.lastExportedBackup.savedLocation
                    ? `<strong>Location:</strong> ${escapeHtml(this.lastExportedBackup.savedLocation)}`
                    : 'Tap <strong>SAVE TO FILES / SHARE</strong> below to choose where to save this backup on your phone (e.g. <strong>Save to Files</strong>, iCloud, or Google Drive), or tap <strong>DOWNLOAD</strong>:'
                }
              </p>
              <div class="backup-actions-grid" style="margin-top:4px;">
                <button type="button" id="btn-share-last-backup" class="btn-primary">
                  SAVE TO FILES / SHARE
                </button>
                <button type="button" id="btn-download-last-backup" class="btn-secondary">
                  DOWNLOAD
                </button>
              </div>
            </div>
          `
              : ''
          }

          <hr class="divider" />

          <div class="restore-section">
            <span class="form-label" style="margin-bottom:8px;">RESTORE ARCHIVE (.ZIP / .JSON)</span>
            <div class="form-row-2 keep-2col-mobile" style="margin-bottom:10px;">
              <select id="restore-mode-select" class="form-select" aria-label="Restore Mode">
                <option value="merge">Merge Mode</option>
                <option value="replace">Replace Mode</option>
              </select>

              <input
                type="file"
                id="input-restore-file"
                accept=".zip,.json,application/zip,application/json"
                class="form-input"
                aria-label="Select Backup File"
              />
            </div>
            <button type="button" id="btn-run-restore" class="btn-secondary btn-block" disabled>
              RESTORE BACKUP
            </button>
          </div>
        </div>
      </section>
    `;

    this.bindEvents();
  }

  bindEvents() {
    if (!this.container) return;

    // Export Full ZIP
    this.container.querySelector('#btn-export-zip')?.addEventListener('click', async () => {
      try {
        LoadingOverlay.show('Building full ZIP backup...', 10);
        const provider = backupManager.getProvider();
        const res = await provider.exportFullBackup((pct, step) => LoadingOverlay.show(step, pct));
        LoadingOverlay.hide();

        this.lastExportedBackup = {
          blob: res.blob,
          filename: res.filename,
          mimeType: 'application/zip',
          size: res.blob ? res.blob.size : 0,
          savedLocation: ''
        };

        await this.loadState();
        this.render();
        showToast(
          `ZIP backup created (${res.filename})! Tap "SAVE TO FILES / SHARE" to choose where to save it.`,
          'success',
          5000
        );
      } catch (err) {
        LoadingOverlay.hide();
        showToast(`Backup export failed: ${err.message}`, 'error');
      }
    });

    // Export Quick JSON
    this.container.querySelector('#btn-export-json')?.addEventListener('click', async () => {
      try {
        LoadingOverlay.show('Exporting JSON backup...', 10);
        const provider = backupManager.getProvider();
        const res = await provider.exportMetadataJson((pct, step) => LoadingOverlay.show(step, pct));
        LoadingOverlay.hide();

        this.lastExportedBackup = {
          blob: res.blob,
          filename: res.filename,
          mimeType: 'application/json',
          size: res.blob ? res.blob.size : 0,
          savedLocation: ''
        };

        await this.loadState();
        this.render();
        showToast(
          `JSON backup created (${res.filename})! Tap "SAVE TO FILES / SHARE" to choose where to save it.`,
          'success',
          5000
        );
      } catch (err) {
        LoadingOverlay.hide();
        showToast(`JSON export failed: ${err.message}`, 'error');
      }
    });

    // 1-Tap Save / Share to Files (executes synchronously inside a fresh user gesture)
    this.container.querySelector('#btn-share-last-backup')?.addEventListener('click', async () => {
      if (!this.lastExportedBackup?.blob) return;
      try {
        const res = await deliverBackupFile({
          blob: this.lastExportedBackup.blob,
          filename: this.lastExportedBackup.filename,
          mimeType: this.lastExportedBackup.mimeType,
          preferDownload: false
        });
        if (!res.aborted) {
          this.lastExportedBackup.savedLocation =
            res.method === 'share'
              ? 'Saved via your device Share / Files menu.'
              : 'Saved to your browser Downloads folder (open Files app → Downloads).';
          this.render();
          showToast(`✓ ${this.lastExportedBackup.savedLocation}`, 'success', 4500);
        }
      } catch (err) {
        showToast(`Could not share backup: ${err.message}`, 'error');
      }
    });

    // 1-Tap Download to Browser
    this.container.querySelector('#btn-download-last-backup')?.addEventListener('click', async () => {
      if (!this.lastExportedBackup?.blob) return;
      await deliverBackupFile({
        blob: this.lastExportedBackup.blob,
        filename: this.lastExportedBackup.filename,
        mimeType: this.lastExportedBackup.mimeType,
        preferDownload: true
      });
      this.lastExportedBackup.savedLocation =
        'Saved to your browser Downloads folder (open Files app → Downloads).';
      this.render();
      showToast(`✓ ${this.lastExportedBackup.savedLocation}`, 'success', 4500);
    });

    // Restore File input & button
    const fileInput = this.container.querySelector('#input-restore-file');
    const restoreBtn = this.container.querySelector('#btn-run-restore');
    const modeSelect = this.container.querySelector('#restore-mode-select');

    fileInput?.addEventListener('change', () => {
      if (restoreBtn) {
        restoreBtn.disabled = !(fileInput.files && fileInput.files.length > 0);
      }
    });

    restoreBtn?.addEventListener('click', async () => {
      const file = fileInput?.files?.[0];
      if (!file) return;
      const mode = modeSelect?.value || 'merge';

      try {
        LoadingOverlay.show(`Restoring backup (${mode} mode)...`, 15);
        const res = await backupManager.importBackup(file, mode, (pct, step) =>
          LoadingOverlay.show(step, pct)
        );
        LoadingOverlay.hide();
        showToast(
          `Restored ${res.garmentsCount} garment(s) and ${res.mediaCount || 0} media file(s)!`,
          'success'
        );
        await this.loadState();
        this.render();
      } catch (err) {
        LoadingOverlay.hide();
        showToast(`Restore failed: ${err.message}`, 'error');
      }
    });

    // Toggle Advanced Settings drawer
    this.container.querySelector('#btn-toggle-advanced-settings')?.addEventListener('click', () => {
      this.isAdvancedOpen = !this.isAdvancedOpen;
      const drawer = this.container.querySelector('#advanced-settings-drawer');
      const btn = this.container.querySelector('#btn-toggle-advanced-settings');
      if (drawer) drawer.classList.toggle('hidden', !this.isAdvancedOpen);
      if (btn) btn.classList.toggle('active', this.isAdvancedOpen);
    });

    // Save Settings form
    const form = this.container.querySelector('#settings-form');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const nextSettings = {
        activeSeason: fd.get('activeSeason') || 'winter',
        location: String(fd.get('location') || '').trim(),
        geminiApiKey: String(fd.get('geminiApiKey') || '').trim(),
        stylePreferences: String(fd.get('stylePreferences') || '').trim()
      };

      await wardrobeDb.updateSettings(nextSettings);
      eventBus.emit('season:changed', { activeSeason: nextSettings.activeSeason });
      showToast('Settings saved!', 'success');
      await this.loadState();
      this.render();
    });

    // Auto-save Styling Preferences on change
    const stylePrefsEl = this.container.querySelector('#style-preferences-input');
    stylePrefsEl?.addEventListener('change', async () => {
      const val = String(stylePrefsEl.value || '').trim();
      await wardrobeDb.setSetting('stylePreferences', val);
      this.settings.stylePreferences = val;
    });

    // Auto-save Gemini API Key immediately on paste/change
    const keyInputEl = this.container.querySelector('#gemini-key-input');
    keyInputEl?.addEventListener('change', async () => {
      const val = String(keyInputEl.value || '').trim();
      await wardrobeDb.setSetting('geminiApiKey', val);
      this.settings.geminiApiKey = val;
    });
    keyInputEl?.addEventListener('paste', () => {
      setTimeout(async () => {
        const val = String(keyInputEl.value || '').trim();
        if (val) {
          await wardrobeDb.setSetting('geminiApiKey', val);
          this.settings.geminiApiKey = val;
          showToast('API key saved automatically! Click "Test" to verify.', 'info');
        }
      }, 50);
    });

    // Test Gemini API Key button
    this.container.querySelector('#btn-test-gemini-key')?.addEventListener('click', async () => {
      const keyInput = this.container.querySelector('#gemini-key-input');
      const candidateKey = String(keyInput?.value || '').trim();
      if (!candidateKey) {
        showToast('Paste your Gemini API key first!', 'error');
        return;
      }
      try {
        LoadingOverlay.show('Testing connection to Google Gemini AI...');
        await testGeminiApiKey(candidateKey);
        await wardrobeDb.setSetting('geminiApiKey', candidateKey);
        LoadingOverlay.hide();
        showToast('✓ Connection successful! Your Gemini API key has been saved.', 'success');
        await this.loadState();
        this.render();
      } catch (err) {
        LoadingOverlay.hide();
        showToast(`Gemini key test failed: ${err.message}`, 'error');
      }
    });
  }

  async unmount() {}
}

export default BackupSettingsView;
