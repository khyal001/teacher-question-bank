import { supabase } from './supabase.js';
import { h } from './ui.js';

// A single bootstrap response includes the navigation role. Later pages omit it.
export function createLibraryPage(kind, container, onChange) {
  let offset = 0;
  let total = 0;
  let request = 0;
  let renderStart = 0;
  let renderVersion = 0;
  const limit = 25;
  // Opt-in DOM diagnostics for real-service checks; no console output, user
  // data, token, URL or visible interface changes on ordinary visits.
  const measure = new URLSearchParams(window.location.search).get('measure') === '1';
  const pager = h('nav', { class: 'library-pagination no-print', 'aria-label': 'صفحات القائمة' });
  container.after(pager);
  return {
    async load(includeMetadata = false) {
      const version = ++request;
      const started = performance.now();
      const { data, error } = await supabase.rpc(`get_${kind}_page`, {
        p_offset: offset, p_limit: limit, p_include_metadata: includeMetadata,
      });
      if (version !== request) return null;
      if (error) throw error;
      if (measure) {
        renderStart = started;
        renderVersion = version;
        container.dataset.rpcMs = String(Math.round(performance.now() - started));
        container.dataset.pageRequests = String(version);
      }
      if (!data || !Array.isArray(data.items) || !Number.isSafeInteger(data.total) || data.total < 0) {
        throw new Error('تعذر تحميل القائمة.');
      }
      total = Number(data.total);
      // Deleting the last item on a page can make that page disappear.
      if (offset >= total && offset > 0) {
        offset = Math.max(0, Math.ceil(total / limit) - 1) * limit;
        return this.load(includeMetadata);
      }
      pager.replaceChildren();
      if (total > limit) {
        for (const [label, next, disabled] of [
          ['السابق', offset - limit, offset === 0],
          ['التالي', offset + limit, offset + limit >= total],
        ]) {
          pager.appendChild(h('button', { type: 'button', class: 'btn btn-secondary btn-sm', disabled,
            onclick: () => { offset = next; onChange(); } }, label));
        }
        pager.appendChild(h('span', { text: `${offset + 1}–${Math.min(offset + limit, total)} من ${total}` }));
      }
      return data;
    },
    rendered() {
      if (!measure || renderVersion !== request) return;
      // Measure completed DOM rendering directly. requestAnimationFrame in a
      // background tab can be throttled and would inflate this measurement.
      container.dataset.listReadyMs = String(Math.round(performance.now() - renderStart));
      container.dataset.pageReadyMs = String(Math.round(performance.now()));
    },
    get total() { return total; },
  };
}

// Coalesce simultaneous cache misses into one Storage signing request. The
// ordinary expiry/pending cache still owns TTL, deduplication and retry rules.
export function batchSigner(signMany) {
  let pending = new Map();
  let scheduled = false;
  return (path, ttl) => new Promise((resolve, reject) => {
    if (!pending.has(path)) pending.set(path, []);
    pending.get(path).push({ resolve, reject });
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(async () => {
      const batch = pending;
      pending = new Map();
      scheduled = false;
      try {
        const urls = await signMany([...batch.keys()], ttl);
        for (const [key, waiters] of batch) {
          const url = urls.get(key);
          for (const waiter of waiters) {
            if (url) waiter.resolve(url);
            else waiter.reject(new Error('تعذر تحميل الشعار.'));
          }
        }
      } catch (error) {
        for (const waiters of batch.values()) for (const waiter of waiters) waiter.reject(error);
      }
    });
  });
}
