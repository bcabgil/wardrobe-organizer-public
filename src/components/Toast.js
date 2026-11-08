/**
 * Toast.js - Non-blocking mobile toast notifications
 */

import { escapeHtml } from '../utils/domUtils.js';

export class Toast {
  static show(message, type = 'info', durationMs = 3200) {
    if (typeof document === 'undefined') return;

    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toastEl = document.createElement('div');
    toastEl.className = `toast-item toast-${type}`;
    const icon = type === 'success' ? '✓' : type === 'error' ? '⚠' : '✨';
    toastEl.innerHTML = `<span class="toast-icon">${icon}</span><span class="toast-text">${escapeHtml(message)}</span>`;
    container.appendChild(toastEl);

    setTimeout(() => {
      toastEl.classList.add('toast-hide');
      setTimeout(() => {
        if (toastEl.parentNode) toastEl.parentNode.removeChild(toastEl);
      }, 250);
    }, durationMs);
  }
}

export const showToast = Toast.show.bind(Toast);
export default Toast;
