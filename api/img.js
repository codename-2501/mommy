// GET /api/img?name=X — serve an image straight from the repo's images/ (raw.githubusercontent).
// The build only ships the images content.json actually uses (as thumbnails, plus a few full-size), so
// the admin's library — which lists EVERY uploaded image — would 404 on the ones not yet placed. A rewrite
// sends any /images/<name> that isn't a shipped static file here, and this streams it from the repo. The
// repo is public, so the raw URL needs no token and has no 1 MB Contents-API size cap.
const REPO = process.env.GH_REPO || 'codename-2501/mommy';
const BRANCH = process.env.GH_BRANCH || 'main';
const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };

module.exports = async (req, res) => {
  try {
    const name = String((req.query && req.query.name) || '').split('/').pop();
    if (!name) return res.status(400).end('no name');
    const raw = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/images/${encodeURIComponent(name)}`;
    const r = await fetch(raw);
    if (!r.ok) return res.status(r.status === 404 ? 404 : 502).end('image not found');
    const buf = Buffer.from(await r.arrayBuffer());
    const ext = (name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
    res.setHeader('Content-Type', TYPES[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=300');   // a just-uploaded image should appear soon
    return res.status(200).end(buf);
  } catch (e) {
    return res.status(500).end(String(e && e.message || e));
  }
};
