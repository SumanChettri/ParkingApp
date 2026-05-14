const express = require("express");
const Booking = require("../models/Booking");
const Slot = require("../models/Slot");
const { requireAdmin, optionalAuth } = require("../middleware/auth");
const iotStateService = require("../services/iotStateService");
const { forceAdminEntryGateSignal, forceAdminExitGateSignal } = require("../services/iotAppGateQueue");

const router = express.Router();

router.use(optionalAuth);
router.use(requireAdmin);

router.get("/bookings", async (req, res) => {
  try {
    const list = await Booking.find().sort({ createdAt: -1 }).limit(200);
    res.json(list);
  } catch (err) {
    res.status(500).json({ message: err.message || "Failed to list bookings" });
  }
});

router.get("/slots", async (req, res) => {
  try {
    const slots = await Slot.find().sort({ slotNumber: 1 });
    res.json(slots);
  } catch (err) {
    res.status(500).json({ message: err.message || "Failed to list slots" });
  }
});

router.get("/dashboard", async (req, res) => {
  try {
    const slots = await Slot.find();
    const total = slots.length;
    const free = slots.filter((s) => s.state === "free").length;
    const booked = slots.filter((s) => s.state === "reserved").length;
    const occupied = slots.filter((s) => s.state === "occupied").length;

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const paidToday = await Booking.find({
      entryPaid: true,
      updatedAt: { $gte: startOfDay }
    }).select("entryFeePaise");
    const revenueToday = paidToday.reduce((sum, b) => sum + (Number(b.entryFeePaise) || 0), 0);

    const activeBookings = await Booking.countDocuments({ status: { $in: ["booked", "entered"] } });

    res.json({
      total,
      free,
      booked,
      occupied,
      revenueToday,
      revenueTodayPaise: revenueToday,
      activeBookings
    });
  } catch (err) {
    res.status(500).json({ message: err.message || "Dashboard failed" });
  }
});

router.post("/gate/trigger", async (req, res) => {
  try {
    // Queue a token so ESP32 polling always sees { open, token } (same as driver OTP flow).
    forceAdminExitGateSignal();
    await iotStateService.setExitGatePending(true);
    res.json({ ok: true, exitGatePending: true });
  } catch (err) {
    res.status(500).json({ message: err.message || "Trigger failed" });
  }
});

router.post("/gate/trigger-entry", async (req, res) => {
  try {
    forceAdminEntryGateSignal();
    await iotStateService.setEntryGatePending(true);
    res.json({ ok: true, entryGatePending: true });
  } catch (err) {
    res.status(500).json({ message: err.message || "Entry trigger failed" });
  }
});

module.exports = router;
