const express = require("express");
const Slot = require("../models/Slot");
const Booking = require("../models/Booking");
const iotStateService = require("../services/iotStateService");
const { clearPendingEntryMemory, clearPendingExitMemory } = require("../services/iotAppGateQueue");
const { clearBaysKeyMatches } = require("../middleware/auth");

const router = express.Router();

/**
 * Staff/demo: clears all bays and cancels active bookings.
 * Accepts BAY_RESET_KEY and/or ADMIN_RESET_KEY (header or body) so legacy and new clients match.
 */
router.post("/reset-bays", async (req, res) => {
  if (!clearBaysKeyMatches(req)) {
    const hasBay = Boolean(String(process.env.BAY_RESET_KEY || "").trim());
    const hasAdm = Boolean(String(process.env.ADMIN_RESET_KEY || "").trim());
    const inProd = process.env.NODE_ENV === "production";
    const msg =
      inProd && (hasBay || hasAdm)
        ? "Forbidden. In Settings, enter the same secret as BAY_RESET_KEY or ADMIN_RESET_KEY from backend/.env, save, then try again."
        : inProd && !hasBay && !hasAdm
          ? "Bay reset is disabled in production until BAY_RESET_KEY or ADMIN_RESET_KEY is set on the server."
          : "Forbidden. Secret does not match BAY_RESET_KEY or ADMIN_RESET_KEY.";
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

