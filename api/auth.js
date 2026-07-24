// Verify the admin key. The entry gate calls this so a wrong/blank password can't slip through:
// 200 = key matches ADMIN_KEY, 403 = wrong (or admin off), 429 = too many wrong tries from this IP.
// The attempt limiter (20 fails -> 15 min lock) is a brake against brute-forcing a short password.
const { authed, need, rateBlocked, noteAuth, tooMany } = require('./_gh');
module.exports = (req, res) => {
  const wait = rateBlocked(req);
  if (wait) return tooMany(res, wait);
  if (!authed(req)) { noteAuth(req, false); return need(res); }
  noteAuth(req, true);
  res.status(200).json({ ok: true });
};
