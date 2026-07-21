// GET  /api/content  — the archive as it stands, tagged with its version (the file's git blob sha)
// POST /api/content  — save the whole archive back, refusing a write based on a stale version (409)
const { ghGet, ghPut, authed, need } = require('./_gh');

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const r = await ghGet('content.json');
      if (r.status === 404) return res.status(200).json({ slides: [], _version: null });
      if (!r.ok) return res.status(502).json({ error: 'load failed: ' + r.status });
      const j = await r.json();
      const content = JSON.parse(Buffer.from(j.content, 'base64').toString('utf-8'));
      content._version = j.sha;                       // the version this reader is basing edits on
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(content);
    }

    if (req.method === 'POST') {
      if (!authed(req)) return need(res);
      const data = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const version = data._version; delete data._version;   // the sha the tab loaded — the lock
      if (!data || !Array.isArray(data.slides)) {
        return res.status(400).json({ error: 'invalid content payload: slides must be a list' });
      }
      const allowEmpty = req.query && req.query.allow_empty === '1';
      if (data.slides.length === 0 && !allowEmpty) {
        return res.status(400).json({ error: 'refusing to erase all slides — pass ?allow_empty=1 if intended' });
      }
      // indent:1 matches the Python writer, so admin saves and build-time reads produce clean diffs
      const b64 = Buffer.from(JSON.stringify(data, null, 1), 'utf-8').toString('base64');
      const r = await ghPut('content.json', b64, 'content: 관리자 편집', version || undefined);
      if (r.status === 409 || r.status === 422) {
        return res.status(409).json({ error: 'content.json 이 이 탭에서 불러온 뒤 변경됐습니다. 새로고침 후 다시 편집하세요 (덮어쓰기 방지)', stale: true });
      }
      if (!r.ok) { const e = await r.text(); return res.status(400).json({ error: 'save failed: ' + e.slice(0, 200) }); }
      const j = await r.json();
      return res.status(200).json({ ok: true, slides: data.slides.length, version: j.content && j.content.sha });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
};
