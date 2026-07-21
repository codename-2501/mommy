// GET    /api/images  — list the image library (names), plus an (empty) info map the UI tolerates
// DELETE /api/images?name=X  — remove an image, refusing if the archive still points at it
const { ghGet, ghDelete, ghCommits, authed, need } = require('./_gh');

const ALLOWED = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
const isImg = (n) => ALLOWED.includes((n.match(/\.[^.]+$/) || [''])[0].toLowerCase());

// every place content.json can point at an image — so a delete can refuse one still in use
function usesOf(content, name) {
  const ref = '/images/' + name;
  const hits = [];
  const hit = (v) => typeof v === 'string' && v.indexOf(ref) !== -1;
  for (const s of content.slides || []) {
    if (hit(s.image)) hits.push('slide ' + (s.id || ''));
    for (const m of s.media || []) if (hit(m.src)) hits.push('slide-body ' + (s.id || ''));
  }
  for (const [pg, blocks] of Object.entries(content.blocks || {})) {
    for (const b of blocks || []) if (b && b.type === 'image' && hit(b.src)) hits.push('page ' + pg);
  }
  for (const [pg, bg] of Object.entries(content.backgrounds || {})) if (hit((bg || {}).src)) hits.push('bg ' + pg);
  const meta = content.meta || {};
  for (const k of ['favicon', 'ogImage']) if (hit(meta[k])) hits.push('meta ' + k);
  if (hit((content.wordmark || {}).image)) hits.push('wordmark');
  return hits;
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const r = await ghGet('images');
      if (r.status === 404) return res.status(200).json({ images: [], info: {} });
      if (!r.ok) return res.status(502).json({ error: 'list failed: ' + r.status });
      const arr = await r.json();
      const files = (Array.isArray(arr) ? arr : []).filter((e) => e.type === 'file' && isImg(e.name));
      const images = files.map((e) => e.name).sort();
      const sizes = {};                       // bytes, straight from the dir listing
      files.forEach((e) => { sizes[e.name] = e.size || 0; });
      // upload dates: each upload commits "image: <name> 업로드", so recent commit messages date the files.
      // A couple of pages cover the recent uploads; anything older (bulk-added) simply has no date.
      const dates = {};
      try {
        for (let page = 1; page <= 2; page++) {
          const cr = await ghCommits('images', page);
          if (!cr.ok) break;
          const cs = await cr.json();
          if (!Array.isArray(cs) || !cs.length) break;
          for (const c of cs) {
            const msg = (c.commit && c.commit.message) || '';
            const m = msg.match(/^image:\s*(.+?)\s+업로드/);
            if (m && !dates[m[1]]) {
              dates[m[1]] = (c.commit.committer && c.commit.committer.date) || (c.commit.author && c.commit.author.date) || '';
            }
          }
          if (cs.length < 100) break;
        }
      } catch (_) { /* dates are a nicety; the list still works without them */ }
      res.setHeader('Cache-Control', 'no-store');
      // info (aspect/colour hints) is computed at build time by build_static.py; the admin tolerates {}
      return res.status(200).json({ images, sizes, dates, info: {} });
    }

    if (req.method === 'DELETE') {
      if (!authed(req)) return need(res);
      const name = String((req.query && req.query.name) || '').split('/').pop();
      if (!name) return res.status(400).json({ error: 'no name' });
      // refuse if still referenced
      const cr = await ghGet('content.json');
      if (cr.ok) {
        const cj = await cr.json();
        const content = JSON.parse(Buffer.from(cj.content, 'base64').toString('utf-8'));
        const uses = usesOf(content, name);
        if (uses.length) return res.status(409).json({ error: '사용 중이라 삭제 불가: ' + uses.slice(0, 5).join(', '), uses });
      }
      const fr = await ghGet('images/' + name);
      if (fr.status === 404) return res.status(200).json({ ok: true, gone: true });
      if (!fr.ok) return res.status(502).json({ error: 'stat failed: ' + fr.status });
      const fj = await fr.json();
      const dr = await ghDelete('images/' + name, 'image: ' + name + ' 삭제', fj.sha);
      if (!dr.ok) { const e = await dr.text(); return res.status(400).json({ error: 'delete failed: ' + e.slice(0, 200) }); }
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
};
