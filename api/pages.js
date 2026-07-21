// GET /api/pages — which pages carry editable copy blocks (the admin's page selector)
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ pages: ['/about'] });
};
