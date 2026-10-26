// Helpers shared by the UI; dependencies are injected so they can be tested offline.
export async function fetchAll(query, orderBy = ['id'], pageSize = 500) {
  for (const column of orderBy) query = query.order(column, { ascending: true });
  const rows = [];
  for (;;) {
    const { data, error, count } = await query.range(rows.length, rows.length + pageSize - 1);
    if (error) {
      // PostgREST can return 416 when the next range is beyond the last row.
      if (error.code === 'PGRST103' && rows.length > 0) return { data: rows, error: null };
      return { data: null, error };
    }
    if (!data?.length) return { data: rows, error: null };
    rows.push(...data);
    if (Number.isSafeInteger(count) && rows.length >= count) return { data: rows, error: null };
    // Do not stop on a short page: the server may cap results below pageSize.
  }
}

// The query must request count: 'exact'. Respect server caps without the usual
// extra empty request, and fetch only the requested visible page.
export async function fetchPage(query, offset = 0, pageSize = 25) {
  const rows = [];
  let total;
  for (;;) {
    const result = await query.range(offset + rows.length, offset + pageSize - 1);
    if (result.error) return { data: null, error: result.error };
    if (!Number.isSafeInteger(result.count) || result.count < 0) {
      return { data: null, error: new Error('تعذر قراءة عدد النتائج.') };
    }
    total = result.count;
    rows.push(...(result.data || []));
    if (!result.data?.length || rows.length >= pageSize || offset + rows.length >= total) {
      return { data: rows, count: total, error: null };
    }
  }
}

export function questionSearchFilter(value) {
  // Quote the PostgREST literal; commas/parentheses cannot add filter operators.
  const literal = String(value).replace(/[\\%_]/g, '\\$&').replace(/"/g, '\\"');
  return `question_text.ilike."%${literal}%",unit.ilike."%${literal}%"`;
}

export function createSignedUrlCache(sign, now = Date.now, ttlSeconds = 3600) {
  const entries = new Map();
  const pending = new Map();
  const peek = (path) => {
    const entry = entries.get(path);
    if (!entry || entry.expiresAt <= now()) {
      entries.delete(path);
      return null;
    }
    return entry.url;
  };
  return {
    peek,
    clear: () => entries.clear(),
    async get(path) {
      if (!path) return null;
      const cached = peek(path);
      if (cached) return cached;
      if (!pending.has(path)) {
        const startedAt = now();
        pending.set(path, Promise.resolve().then(() => sign(path, ttlSeconds)).then((url) => {
          entries.set(path, { url, expiresAt: startedAt + (ttlSeconds - 60) * 1000 });
          return url;
        }).finally(() => pending.delete(path)));
      }
      return pending.get(path);
    },
  };
}

export async function performSignOut(client, redirect) {
  const { error } = await client.auth.signOut();
  if (error) throw error;
  redirect();
}

export function createRequestGate() {
  let version = 0;
  return { next: () => ++version, isCurrent: (token) => token === version };
}

export async function waitForPrintAssets(doc) {
  if (doc.fonts?.ready) await doc.fonts.ready;
  await Promise.all(Array.from(doc.querySelectorAll('img')).map(async (img) => {
    if (!img.complete) {
      await new Promise((resolve, reject) => {
        const cleanup = () => {
          img.removeEventListener('load', loaded);
          img.removeEventListener('error', failed);
        };
        const loaded = () => { cleanup(); resolve(); };
        const failed = () => { cleanup(); reject(new Error('تعذر تحميل شعار الاختبار للطباعة.')); };
        img.addEventListener('load', loaded, { once: true });
        img.addEventListener('error', failed, { once: true });
        if (img.complete) loaded();
      });
    }
    if (!img.naturalWidth) throw new Error('تعذر تحميل شعار الاختبار للطباعة.');
    if (img.decode) await img.decode();
  }));
}
