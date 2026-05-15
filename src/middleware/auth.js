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
    /* invalid token */
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

/** Header / body / query for staff dashboard routes (optional if JWT admin). */
function getProvidedAdminKey(req) {
  const h = String(req.get("x-admin-reset-key") || req.header("x-admin-reset-key") || "").trim();
  if (h) return h;
  const b = req.body && typeof req.body === "object" ? req.body.adminKey : undefined;
  if (b != null && String(b).trim()) return String(b).trim();
  const q = req.query?.adminKey;
  if (q != null && String(q).trim()) return String(q).trim();
  return "";
}

function configuredAdminResetKey() {
  return String(process.env.ADMIN_RESET_KEY || "").trim();
}

/** JWT admin, or ADMIN_RESET_KEY when set. */
function requireAdmin(req, res, next) {
  if (req.user?.role === "admin") return next();
  const expected = configuredAdminResetKey();
  if (expected && getProvidedAdminKey(req) === expected) return next();
  return res.status(403).json({ message: "Admin only (JWT admin or ADMIN_RESET_KEY)." });
}

/** Dedicated key for POST /api/slots/reset-bays only (see BAY_RESET_KEY in .env). */
function getProvidedBayResetKey(req) {
  const h = String(req.get("x-bay-reset-key") || req.header("x-bay-reset-key") || "").trim();
  if (h) return h;
  const b = req.body && typeof req.body === "object" ? req.body.bayResetKey : undefined;
  if (b != null && String(b).trim()) return String(b).trim();
  const q = req.query?.bayResetKey;
  if (q != null && String(q).trim()) return String(q).trim();
  return "";
}

function configuredBayResetKey() {
  return String(process.env.BAY_RESET_KEY || "").trim();
}

/** Clear-all-bays: must match BAY_RESET_KEY in production; in dev allows if key unset. */
function bayResetKeyMatches(req) {
  const expected = configuredBayResetKey();
  if (!expected) return process.env.NODE_ENV !== "production";
  return getProvidedBayResetKey(req) === expected;
}

/**
 * POST /api/slots/reset-bays — accepts the same secret sent as bay OR admin headers/body
 * (covers legacy servers that only checked ADMIN_RESET_KEY, and apps that send one or both).
 */
function clearBaysKeyMatches(req) {
  const bayExpected = configuredBayResetKey();
  const adminExpected = configuredAdminResetKey();
  if (!bayExpected && !adminExpected) {
    return process.env.NODE_ENV !== "production";
  }
  const secret = String(getProvidedBayResetKey(req) || getProvidedAdminKey(req) || "").trim();
  if (!secret) return false;
  if (bayExpected && secret === bayExpected) return true;
  if (adminExpected && secret === adminExpected) return true;
  return false;
}

module.exports = {
  signUser,
  optionalAuth,
  requireAuth,
  requireAdmin,
  jwtSecret,
  getProvidedAdminKey,
  getProvidedBayResetKey,
  bayResetKeyMatches,
  clearBaysKeyMatches
};
