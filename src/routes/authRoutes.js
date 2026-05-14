const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const { signUser, requireAuth, jwtSecret } = require("../middleware/auth");

const router = express.Router();

router.post("/register", async (req, res) => {
  try {
    if (!jwtSecret()) {
      return res.status(503).json({ message: "Server auth is not configured (set JWT_SECRET in .env)" });
    }
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    const password = String(req.body?.password || "");
    const name = String(req.body?.name || "").trim();
    const adminInvite = String(req.body?.adminInvite || "").trim();
    if (!email || !password) return res.status(400).json({ message: "email and password are required" });
    if (password.length < 6) return res.status(400).json({ message: "password must be at least 6 characters" });

    const exists = await User.findOne({ email });
    if (exists) return res.status(409).json({ message: "Email already registered" });

    let role = "user";
    const invite = process.env.ADMIN_INVITE_CODE;
    if (invite && adminInvite && adminInvite === invite) role = "admin";

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ email, passwordHash, name: name || email.split("@")[0], role });
    const token = signUser(user);
    res.status(201).json({
      token,
      user: { id: user._id, email: user.email, name: user.name, role: user.role }
    });
  } catch (err) {
    res.status(500).json({ message: err.message || "Registration failed" });
  }
});

router.post("/login", async (req, res) => {
  try {
    if (!jwtSecret()) {
      return res.status(503).json({ message: "Server auth is not configured (set JWT_SECRET in .env)" });
    }
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    const password = String(req.body?.password || "");
    if (!email || !password) return res.status(400).json({ message: "email and password are required" });

    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ message: "Invalid email or password" });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ message: "Invalid email or password" });

    const token = signUser(user);
    res.json({
      token,
      user: { id: user._id, email: user.email, name: user.name, role: user.role }
    });
  } catch (err) {
    res.status(500).json({ message: err.message || "Login failed" });
  }
});

router.get("/me", requireAuth, async (req, res) => {
  res.json({
    id: req.user._id,
    email: req.user.email,
    name: req.user.name,
    role: req.user.role
  });
});

module.exports = router;
