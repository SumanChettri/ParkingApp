const express = require("express");
const Slot = require("../models/Slot");
const Booking = require("../models/Booking");
const iotStateService = require("../services/iotStateService");
const { clearPendingEntryMemory, clearPendingExitMemory } = require("../services/iotAppGateQueue");
const { bayResetKeyMatches } = require("../middleware/auth");

const router = express.Router();

/** Dev / admin: frees every bay — fixes stuck “everything booked” test data */
router.post("/reset-bays", async (req, res) => {
  if (!bayResetKeyMatches(req)) {
    return res.status(403).json({
      message:
        "Forbidden. Set BAY_RESET_KEY on the server. Send header x-bay-reset-key or JSON { \"bayResetKey\": \"...\" } (production requires a key)."
    });
  }
  await Slot.updateMany({}, { $set: { state: "free", vacatedAt: null, lastSensorState: false } });
  await Booking.updateMany(
    { status: { $in: ["booked", "entered"] } },
    {
      $set: {
        status: "cancelled",
        entryOtpHash: "",
        exitOtpHash: "",
        demoEntryOtp: "",
        demoExitOtp: "",
        otpExpiresAt: new Date()
      }
    }
  );
  clearPendingEntryMemory();
  clearPendingExitMemory();
  await iotStateService.resetIotHardwareState();
  const slots = await Slot.find().sort({ slotNumber: 1 });
  res.json({ ok: true, message: "All bays marked free and active sessions cancelled.", slots });
});

router.get("/", async (req, res) => {
  const slots = await Slot.find().sort({ slotNumber: 1 });
  res.json(slots);
});

module.exports = router;
