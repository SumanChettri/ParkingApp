const express = require("express");
const Slot = require("../models/Slot");
const Booking = require("../models/Booking");
const iotStateService = require("../services/iotStateService");
const { clearPendingEntryMemory, clearPendingExitMemory } = require("../services/iotAppGateQueue");
const { bayResetKeyMatches } = require("../middleware/auth");

const router = express.Router();

/**
 * Staff/demo: clears all bays and cancels active bookings.
 * In production with BAY_RESET_KEY set, requires matching x-bay-reset-key (or body bayResetKey).
 * Dev / no key: allowed when NODE_ENV is not production (see bayResetKeyMatches).
 */
router.post("/reset-bays", async (req, res) => {
  if (!bayResetKeyMatches(req)) {
    const hasKey = Boolean(String(process.env.BAY_RESET_KEY || "").trim());
    const inProd = process.env.NODE_ENV === "production";
    const msg =
      hasKey && inProd
        ? "Forbidden. Set BAY_RESET_KEY in backend/.env and send header x-bay-reset-key (or body bayResetKey) with the same value, or run outside production."
        : inProd && !hasKey
          ? "Bay reset is disabled in production until BAY_RESET_KEY is set on the server."
          : "Forbidden. Bay reset key does not match BAY_RESET_KEY.";
    return res.status(403).json({ message: msg });
  }

  try {
    console.log("[slotRoutes] /api/slots/reset-bays called");

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

