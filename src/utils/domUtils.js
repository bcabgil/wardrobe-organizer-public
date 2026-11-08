/**
 * domUtils.js - Safe HTML escaping, sanitization, and SVG garment placeholders
 */

export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizeParamValue(val) {
  if (val === null || val === undefined) return '';
  return String(val)
    .replace(/<\/?script[^>]*>/gi, '')
    .replace(/[<>]/g, '')
    .trim();
}

export function getCategoryIconSvg(category = 'top') {
  const cat = String(category).toLowerCase();
  if (cat === 'bottom') {
    return `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="garment-placeholder-svg"><path d="M18 10h28l4 44h-12l-6-26-6 26H14l4-44z"/></svg>`;
  }
  if (cat === 'outerwear') {
    return `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="garment-placeholder-svg"><path d="M22 10l-12 10 6 12 6-4v26h20V28l6 4 6-12-12-10-6 6h-8l-6-6z"/><line x1="32" y1="16" x2="32" y2="54"/></svg>`;
  }
  if (cat === 'one-piece') {
    return `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="garment-placeholder-svg"><path d="M24 10h16l4 14-6 6 8 24H18l8-24-6-6 4-14z"/></svg>`;
  }
  if (cat === 'shoes') {
    return `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="garment-placeholder-svg"><path d="M18 14h16l2 22 14 6v8H14V14h4z"/></svg>`;
  }
  if (cat === 'accessory') {
    return `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="garment-placeholder-svg"><rect x="14" y="24" width="36" height="26" rx="4"/><path d="M24 24V18a8 8 0 0 1 16 0v6"/></svg>`;
  }
  // Default: top / sweater / t-shirt
  return `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="garment-placeholder-svg"><path d="M22 12l-12 10 6 10 6-4v24h20V28l6 4 6-10-12-10a8 8 0 0 1-16 0z"/></svg>`;
}

export function getNavIconSvg(name = 'wardrobe') {
  switch (name) {
    case 'wardrobe':
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="ui-svg-icon"><path d="M12 7a2 2 0 1 0-2-2c0 1.1.9 2 2 2zm0 0v2m-8.5 8L12 9l8.5 8H3.5z"/></svg>`;
    case 'create':
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="ui-svg-icon"><path d="M12 2.5l2.4 7.1 7.1 2.4-7.1 2.4-2.4 7.1-2.4-7.1-7.1-2.4 7.1-2.4L12 2.5z"/></svg>`;
    case 'add':
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-svg-icon"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
    case 'laundry':
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="ui-svg-icon"><line x1="3" y1="6" x2="21" y2="6"/><path d="M5 6l2 14h10l2-14"/><line x1="9.5" y1="10" x2="10" y2="16"/><line x1="14.5" y1="10" x2="14" y2="16"/></svg>`;
    case 'settings':
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="ui-svg-icon"><circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="6.8"/><line x1="12" y1="2.2" x2="12" y2="5.2"/><line x1="12" y1="18.8" x2="12" y2="21.8"/><line x1="2.2" y1="12" x2="5.2" y2="12"/><line x1="18.8" y1="12" x2="21.8" y2="12"/><line x1="5.1" y1="5.1" x2="7.2" y2="7.2"/><line x1="16.8" y1="16.8" x2="18.9" y2="18.9"/><line x1="18.9" y1="5.1" x2="16.8" y2="7.2"/><line x1="7.2" y1="16.8" x2="5.1" y2="18.9"/></svg>`;
    default:
      return '';
  }
}

export function getUiIconSvg(name = '') {
  switch (name) {
    case 'check':
      return `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ui-svg-icon-sm"><polyline points="4 10.5 8.2 14.5 16 6"/></svg>`;
    case 'laundry-basket':
      return `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="ui-svg-icon-sm"><line x1="3" y1="5.5" x2="17" y2="5.5"/><path d="M4.5 5.5l1.5 10.5h8l1.5-10.5"/><line x1="8" y1="8.5" x2="8.4" y2="13"/><line x1="12" y1="8.5" x2="11.6" y2="13"/></svg>`;
    case 'search':
      return `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="ui-svg-icon-sm"><circle cx="8.5" cy="8.5" r="5.5"/><line x1="13" y1="13" x2="17" y2="17"/></svg>`;
    case 'filter':
      return `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="ui-svg-icon-sm"><line x1="3" y1="6" x2="17" y2="6"/><line x1="6" y1="10" x2="14" y2="10"/><line x1="9" y1="14" x2="11" y2="14"/></svg>`;
    case 'camera':
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="ui-svg-icon"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`;
    case 'video':
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="ui-svg-icon"><rect x="2" y="6" width="14" height="12" rx="2" ry="2"/><polygon points="22 8 16 12 22 16 22 8"/></svg>`;
    case 'plus':
      return `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="ui-svg-icon-sm"><line x1="10" y1="4" x2="10" y2="16"/><line x1="4" y1="10" x2="16" y2="10"/></svg>`;
    case 'close':
      return `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="ui-svg-icon-sm"><line x1="5" y1="5" x2="15" y2="15"/><line x1="15" y1="5" x2="5" y2="15"/></svg>`;
    case 'chevron-down':
      return `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="ui-svg-icon-sm"><polyline points="5 7.5 10 12.5 15 7.5"/></svg>`;
    case 'chevron-left':
      return `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="ui-svg-icon-sm"><polyline points="12.5 5 7.5 10 12.5 15"/></svg>`;
    case 'chevron-right':
      return `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="ui-svg-icon-sm"><polyline points="7.5 5 12.5 10 7.5 15"/></svg>`;
    default:
      return '';
  }
}

export function formatBytes(bytes = 0) {
  if (!bytes || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatRelativeDate(isoString) {
  if (!isoString) return 'Never';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return 'Unknown';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export default {
  escapeHtml,
  sanitizeParamValue,
  getCategoryIconSvg,
  getNavIconSvg,
  getUiIconSvg,
  formatBytes,
  formatRelativeDate
};
