// POST /api/upload?name=X  — add an image to the library (committed to images/).
// The browser sends the file base64-encoded in a JSON body ({data}) rather than raw bytes: a JSON body
// is parsed reliably across runtimes, and base64 is what the GitHub API wants anyway.
const { ghGet, ghPut, authed, need } = require('./_gh');

const ALLOWED = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
function safeName(n) {
  n = String(n || '').split('/').pop().split('\\').pop();
  n = n.replace(/[^A-Za-z0-9._-]/g, '_');
  return n || 'upload.bin';
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
    if (!authed(req)) return need(res);

    let name = safeName((req.query && req.query.name) || 'upload');
    const ext = (name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
    if (!ALLOWED.includes(ext)) return res.status(400).json({ error: 'unsupported file type: ' + ext });

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    let b64 = body.data || '';
    if (b64.indexOf(',') !== -1 && b64.slice(0, 5) === 'data:') b64 = b64.slice(b64.indexOf(',') + 1);  // strip data: URL prefix
    if (!b64) return res.status(400).json({ error: 'no image data' });

    // avoid clobbering a different existing file: name, name-1, name-2, ...
    const stem = name.slice(0, name.length - ext.length);
    let finalName = name, i = 1;
    for (;;) {
      const chk = await ghGet('images/' + finalName);
      if (chk.status === 404) break;
      if (!chk.ok && chk.status !== 200) break;
      finalName = `${stem}-${i}${ext}`; i++;
      if (i > 50) return res.status(400).json({ error: 'too many name collisions' });
    }

    const r = await ghPut('images/' + finalName, b64, 'image: ' + finalName + ' 업로드');
    if (!r.ok) { const e = await r.text(); return res.status(400).json({ error: 'upload failed: ' + e.slice(0, 200) }); }
    return res.status(200).json({ ok: true, image: '/images/' + finalName, name: finalName });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
};

// larger images need a bigger body limit than the default
module.exports.config = { api: { bodyParser: { sizeLimit: '25mb' } } };
