const jwt = require('jsonwebtoken');
require("dotenv").config()

function verifyToken(req, res, next) {
  const token = req.headers['authorization'].substring(7);
  if (!token) {
    return res.status(401).json({message: 'No token provided'});
  }
  try {
    const payload = jwt.verify(token, process.env.JWSEC);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({message: 'Invalid token'});
  }
}
module.exports = verifyToken;