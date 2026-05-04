const express = require("express");
const Slot = require("../models/Slot");
const { verifyAndOpenGate } = require("../services/gateService");

const router = express.Router();

const VACATED_SENSOR_GRACE_MS = 15000;

router.post("/sensor", async (req, res) => {
  const { sensorId, isOccupied } = req.body;
  const slot = await Slot.findOne({ sensorId });
  if (!slot) return res.status(404).json({ message: "Sensor mapping not found" });
  const occ = Boolean(isOccupied);
  slot.lastSensorState = occ;

  if (slot.state === "reserved") {
    await slot.save();
    return res.json({ success: true });
  }

  const now = Date.now();
  const vacatedAtMs = slot.vacatedAt ? new Date(slot.vacatedAt).getTime() : 0;
  const recentlyVacated = vacatedAtMs > 0 && now - vacatedAtMs < VACATED_SENSOR_GRACE_MS;
  /** After exit OTP, stay "free" briefly so IR jitter doesn't reclaim the bay before refresh. */
  if (slot.state === "free" && occ === true && recentlyVacated) {
    await slot.save();
    return res.json({ success: true, suppressed: "recentlyVacated" });
  }

  slot.state = occ ? "occupied" : "free";
  slot.vacatedAt = null;
  await slot.save();
  res.json({ success: true });
});

router.post("/keypad", async (req, res) => {
  const { bookingId, otp, gate } = req.body;
  try {
    await verifyAndOpenGate({ bookingId, otp, type: gate });
    res.json({
      success: true,
      gate,
      servoCommand: "open",
      message: `${gate} gate open signal ready for ESP`
    });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message || "Keypad verification failed" });
  }
});

module.exports = router;
