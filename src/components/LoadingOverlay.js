/**
 * LoadingOverlay.js - Full-screen progress & AI loading overlay
 */

import { escapeHtml } from '../utils/domUtils.js';

export class LoadingOverlay {
  static show(label = 'Loading...', percent = null) {
    if (typeof document === 'undefined') return;

    let overlay = document.getElementById('app-loading-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'app-loading-overlay';
      overlay.className = 'loading-overlay';
      document.body.appendChild(overlay);
    }

    const pctHtml = typeof percent === 'number'
      ? `<div class="loading-progress-bar"><div class="loading-progress-fill" style="width:${Math.min(100, Math.max(0, percent))}%"></div></div><div class="loading-pct">${Math.round(percent)}%</div>`
      : '';

    overlay.innerHTML = `
      <div class="loading-card">
        <div class="loading-spinner"></div>
        <div class="loading-label">${escapeHtml(label)}</div>
        ${pctHtml}
      </div>
    `;
    overlay.style.display = 'flex';
  }

  static hide() {
    if (typeof document === 'undefined') return;
    const overlay = document.getElementById('app-loading-overlay');
    if (overlay) {
      overlay.style.display = 'none';
    }
  }
}

export default LoadingOverlay;
