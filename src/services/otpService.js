const bcrypt = require("bcryptjs");

function generateOtp(length = 6) {
  let otp = "";
  for (let i = 0; i < length; i += 1) {
    otp += Math.floor(Math.random() * 10);
  }
  return otp;
}

async function hashOtp(otp) {
  return bcrypt.hash(otp, 10);
}

async function verifyOtp(otp, hash) {
  return bcrypt.compare(otp, hash);
}

module.exports = { generateOtp, hashOtp, verifyOtp };
