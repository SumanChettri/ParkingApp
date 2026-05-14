const mongoose = require("mongoose");

const slotSchema = new mongoose.Schema(
  {
    slotNumber: { type: Number, required: true, unique: true, min: 1, max: 6 },
    sensorId: { type: String, required: true, unique: true },
    state: {
      type: String,
      enum: ["free", "reserved", "occupied", "blocked"],
      default: "free"
    },
    lastSensorState: { type: Boolean, default: false },
    /** Set when bay is freed via exit OTP — IR may briefly still see a vehicle; suppress free→occupied for a short window. */
    vacatedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Slot", slotSchema);
