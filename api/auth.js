// Verify the admin key. The entry gate calls this so a wrong/blank password can't slip through:
// 200 = key matches ADMIN_KEY, 403 = wrong (or admin off). No repo access — just the key check.
const { authed, need } = require('./_gh');
module.exports = (req, res) => {
  if (!authed(req)) return need(res);
  res.status(200).json({ ok: true });
};
