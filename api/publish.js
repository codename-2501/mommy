// POST /api/publish — kept for the existing admin button, but a no-op now: on this setup every save and
// upload already COMMITS to the repo, and the commit is what triggers the rebuild+deploy. So the archive
// is always "published" the moment it is saved; there is no separate local copy to carry up.
const { authed, need } = require('./_gh');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  if (!authed(req)) return need(res);
  return res.status(200).json({ ok: true, already: true, note: '저장 시 이미 게시됩니다(커밋→자동 배포).' });
};
