function num(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

function graceMinutes() {
  return num("GRACE_PERIOD_MINUTES", 10);
}

/** Smallest currency unit: paise for INR. */
const VEHICLE_TYPES = ["two_wheeler", "four_wheeler", "suv", "heavy"];

function hourlyRateMinorForVehicleType(vehicleType) {
  if (vehicleType === "two_wheeler") {
    return num("HOURLY_TWO_WHEELER_PAISE", 500);
  }
  if (vehicleType === "suv") {
    return num("HOURLY_SUV_PAISE", 1000);
  }
  if (vehicleType === "heavy") {
    return num("HOURLY_HEAVY_PAISE", 1200);
  }
  if (vehicleType === "four_wheeler") {
    return num("HOURLY_FOUR_WHEELER_PAISE", 800);
  }
  return num("HOURLY_DEFAULT_PAISE", 800);
}

function vehicleHourlyPricingTable() {
  const rows = {};
  for (const t of VEHICLE_TYPES) {
    rows[t] = hourlyRateMinorForVehicleType(t);
  }
  return rows;
}

function totalAmountMinorForDuration(vehicleType, durationMins) {
  const mins = Number(durationMins);
  if (!Number.isFinite(mins) || mins <= 0) return 0;
  const billableHours = Math.max(1, Math.ceil(mins / 60));
  return billableHours * hourlyRateMinorForVehicleType(vehicleType);
}

function otpBufferAfterEndMs() {
  return num("OTP_VALID_AFTER_END_MS", 3600000);
}

/** Helps UI show ₹/30min and ₹/hr equivalents for chosen window (informational — entry/exit fees are discrete). */
function rateHintsMinor(vehicleType, durationMins) {
  const d = Number(durationMins);
  if (!Number.isFinite(d) || d <= 0) return { per30MinMinor: null, perHourMinor: null, visitOnTimeMinor: null };
  const visit = totalAmountMinorForDuration(vehicleType, durationMins);
  return {
    visitOnTimeMinor: visit,
    per30MinMinor: Math.ceil((visit * 30) / d),
    perHourMinor: Math.ceil((visit * 60) / d)
  };
}

/**
 * Exit billing uses booked window from DB (`endTime`) + grace minutes.
 * Within `endTime + grace`: no extra charge (e.g. booked 1h, stayed 55m → OK).
 * After grace: bill extra time in whole hours at the vehicle hourly rate (same as booking tariff).
 */
function computeExitQuote(booking, now = new Date()) {
  const end = new Date(booking.endTime);
  const gm = graceMinutes();
  const graceEndsAt = new Date(end.getTime() + gm * 60 * 1000);
  let minutesPastGrace = 0;
  let overstayBillableHours = 0;
  let overstayMinor = 0;
  const hourly = hourlyRateMinorForVehicleType(booking.vehicleType);

  if (now > graceEndsAt) {
    minutesPastGrace = Math.ceil((now.getTime() - graceEndsAt.getTime()) / 60000);
    overstayBillableHours = Math.max(1, Math.ceil(minutesPastGrace / 60));
    overstayMinor = overstayBillableHours * hourly;
  }

  return {
    scheduledEndAt: end.toISOString(),
    graceEndsAt: graceEndsAt.toISOString(),
    graceMinutes: gm,
    minutesPastGrace,
    overstayBillableHours,
    withinFreeExitWindow: now <= graceEndsAt,
    currency: (process.env.PAYMENT_CURRENCY || "INR").toUpperCase(),
    breakdown: {
      overstayPerHourMinor: hourly,
      overstayMinor,
      totalMinor: overstayMinor
    }
  };
}

module.exports = {
  VEHICLE_TYPES,
  graceMinutes,
  hourlyRateMinorForVehicleType,
  vehicleHourlyPricingTable,
  totalAmountMinorForDuration,
  rateHintsMinor,
  otpBufferAfterEndMs,
  computeExitQuote
};
