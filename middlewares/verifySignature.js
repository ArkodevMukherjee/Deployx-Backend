const crypto = require("crypto");

function verifySignature(req, res, next) {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature) return res.status(401).send('Missing signature');

  const hmac = crypto.createHmac('sha256', process.env.GITHUB_WEBHOOK_SECRET);
  const digest = `sha256=${hmac.update(req.rawBody).digest('hex')}`;

  if (signature !== digest) {
    return res.status(403).send('Invalid signature');
  }

  next();
}

module.exports = verifySignature