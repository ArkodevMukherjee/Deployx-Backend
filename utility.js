function generateAppJWT() {
  const privateKey = fs.readFileSync('./private.pem');

  return jwt.sign(
    {
      iat: Math.floor(Date.now() / 1000) - 60,
      exp: Math.floor(Date.now() / 1000) + 600,
      iss: GITHUB_APP_ID
    },
    privateKey,
    { algorithm: 'RS256' }
  );
}

async function getInstallationToken(installationId) {
  console.log("getInstallationToken CALLED");
  console.log("installationId:", installationId);

  const appJwt = generateAppJWT();
  console.log("JWT GENERATED");

  try {
    const response = await axios.post(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {},
      {
        headers: {
          Authorization: `Bearer ${appJwt}`,
          Accept: 'application/vnd.github+json'
        }
      }
    );

    console.log("INSTALLATION TOKEN RESPONSE");
    console.log(response.data);

    return response.data.token;
  } catch (err) {
    console.error("❌ FAILED TO GET INSTALLATION TOKEN");
    console.error("STATUS:", err.response?.status);
    console.error("DATA:", err.response?.data);
    throw err;
  }
}

function verifySignature(req, res, next) {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature) return res.status(401).send('Missing signature');

  const hmac = crypto.createHmac('sha256', GITHUB_WEBHOOK_SECRET);
  const digest = `sha256=${hmac.update(req.rawBody).digest('hex')}`;

  if (signature !== digest) {
    return res.status(403).send('Invalid signature');
  }

  next();
}