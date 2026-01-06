const jwt = require('jsonwebtoken');

module.exports = function authenticateJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  console.log(authHeader);
  if (!authHeader) return res.status(401).json({ message: 'Token missing' });

  const token = authHeader.split(' ')[1];
  console.log("Token",token);
  console.log(process.env.JWT_SECRET);
  jwt.verify(token, process.env.JWT_SECRET, (err, payload) => {
    if (err) return res.status(403).json({ message: err });

    req.user = payload; // { id, provider }
    next();
  });
};