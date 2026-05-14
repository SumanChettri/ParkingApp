const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

function loadEnvOnce() {
  require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
}

async function connectDB() {
  loadEnvOnce();

  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) {
    const envPath = path.join(__dirname, "..", "..", ".env");
    const hint = fs.existsSync(envPath)
      ? `Found ${envPath} but MONGODB_URI is empty or invalid.`
      : `Missing ${envPath}. Copy backend/.env.example to backend/.env and set MONGODB_URI.`;
    throw new Error(`MONGODB_URI is required. ${hint}`);
  }

  const forceIpv4 = String(process.env.MONGODB_FORCE_IPV4 || "true").toLowerCase() !== "false";
  const options = {
    serverSelectionTimeoutMS: Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || 15000)
  };
  if (forceIpv4) options.family = 4;

  try {
    await mongoose.connect(uri, options);
    console.log("MongoDB connected");
  } catch (err) {
    const tips = [
      "Atlas Network Access must include your current public IP (or 0.0.0.0/0 for testing).",
      "Atlas DB user/password in MONGODB_URI must be valid.",
      "If your ISP/router has IPv6/DNS issues, keep MONGODB_FORCE_IPV4=true (default)."
    ];
    const base = err?.message || "MongoDB connection failed";
    throw new Error(`${base}\nTroubleshooting:\n- ${tips.join("\n- ")}`);
  }
}

module.exports = { connectDB };
