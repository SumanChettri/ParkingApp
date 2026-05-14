const mongoose = require("mongoose");

const bookingSchema = new mongoose.Schema(
  {
    name: { type: String, default: "Guest" },
    email: { type: String, default: "" },
    vehicleNumber: { type: String, required: true, unique: true, trim: true, uppercase: true },
    vehicleType: {
      type: String,
      enum: ["two_wheeler", "four_wheeler", "suv", "heavy"],
      required: true
    },
    entryFeePaise: { type: Number, required: true, min: 1 },
    slotNumber: { type: Number, required: true, min: 1, max: 6 },
    startTime: { type: Date, required: true },
    endTime: { type: Date, required: true },
    status: {
      type: String,
      enum: ["booked", "entered", "exited", "cancelled"],
      default: "booked"
    },
    entryOtpHash: { type: String, default: "" },
    exitOtpHash: { type: String, default: "" },
    otpExpiresAt: { type: Date, required: true },
    demoEntryOtp: { type: String, default: "" },
    demoExitOtp: { type: String, default: "" },
    entryOtpUsedAt: { type: Date, default: null },
    exitOtpUsedAt: { type: Date, default: null },
    entryPaid: { type: Boolean, default: false },
    exitPaid: { type: Boolean, default: false },
    razorpayEntryOrderId: { type: String, default: "" },
    razorpayExitOrderId: { type: String, default: "" },
    razorpayEntryPaymentId: { type: String, default: "" },
    razorpayExitPaymentId: { type: String, default: "" },
    actualEnteredAt: { type: Date, default: null },
    actualExitedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Booking", bookingSchema);
