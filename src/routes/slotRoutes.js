const express = require("express");
const Slot = require("../models/Slot");
const Booking = require("../models/Booking");
const iotStateService = require("../services/iotStateService");
const { clearPendingEntryMemory, clearPendingExitMemory } = require("../services/iotAppGateQueue");

const router = express.Router();

/**
 * TEST/DEMO endpoint (OPEN): Clears all bays and cancels active bookings.
 * No ADMIN_RESET_KEY, no auth, no environment key dependency.
 */
router.post("/reset-bays", async (req, res) => {
  try {
    console.log("[slotRoutes] /api/slots/reset-bays called (open reset)");

    // 1) Reset slots
    await Slot.updateMany(
      {},
      { $set: { state: "free", vacatedAt: null, lastSensorState: false } }
    );

    // 2) Cancel active/queued bookings that could block UI/flows
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

    // 3) Clear any in-memory gate queue state
    clearPendingEntryMemory();
    clearPendingExitMemory();

    // 4) Reset cached IOT singleton hardware state
    await iotStateService.resetIotHardwareState();

    const slots = await Slot.find().sort({ slotNumber: 1 });

    res.json({
      success: true,
      message: "All bays cleared",
      slots
    });
  } catch (err) {
    console.error("[slotRoutes] reset-bays failed:", err);
    res.status(500).json({
      success: false,
      message: "Failed to clear bays",
      error: err?.message || String(err)
    });
  }
});

router.get("/", async (req, res) => {
  const slots = await Slot.find().sort({ slotNumber: 1 });
  res.json(slots);
});

module.exports = router;

