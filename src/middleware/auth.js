const jwt = require("jsonwebtoken");
const User = require("../models/User");

function jwtSecret() {
  const j = process.env.JWT_SECRET;
  if (!j) return null;
  return j;
}

function signUser(user) {
  const secret = jwtSecret();
  if (!secret) throw new Error("JWT_SECRET is not set");
  return jwt.sign({ sub: String(user._id), role: user.role }, secret, { expiresIn: "14d" });
}

async function optionalAuth(req, res, next) {
  const secret = jwtSecret();
  if (!secret) return next();
  try {
    const h = req.headers.authorization || "";
    const m = h.match(/^Bearer\s+(.+)$/i);
    if (!m) return next();
    const payload = jwt.verify(m[1].trim(), secret);
    const user = await User.findById(payload.sub).select("-passwordHash");
    if (user) req.user = user;
  } catch {
    /* invalid token — ignore for optional */
  }
  next();
}

async function requireAuth(req, res, next) {
  const secret = jwtSecret();
  if (!secret) return res.status(503).json({ message: "Auth is not configured (JWT_SECRET missing)" });
  try {
    const h = req.headers.authorization || "";
    const m = h.match(/^Bearer\s+(.+)$/i);
    if (!m) return res.status(401).json({ message: "Authorization Bearer token required" });
    const payload = jwt.verify(m[1].trim(), secret);
    const user = await User.findById(payload.sub).select("-passwordHash");
    if (!user) return res.status(401).json({ message: "User not found" });
    req.user = user;
    return next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
}

/** JWT role admin, or trusted admin header (same key as bay reset). */
function requireAdmin(req, res, next) {
  if (req.user?.role === "admin") return next();
  const k = process.env.ADMIN_RESET_KEY;
  if (k && req.header("x-admin-reset-key") === k) return next();
  return res.status(403).json({ message: "Admin only" });
}

module.exports = { signUser, optionalAuth, requireAuth, requireAdmin, jwtSecret };
