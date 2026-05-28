// src/services/otp.js
const { OTP } = require('../models');

const OTP_TTL_MINUTES = 10;
const MAX_ATTEMPTS    = 3;

/**
 * Generate a 4-digit OTP and save it to DB.
 */
async function createOTP(appointmentId, phone) {
  // Invalidate any existing pending OTPs for this appointment
  await OTP.updateMany(
    { appointmentId, verificationStatus: 'PENDING' },
    { verificationStatus: 'EXPIRED' }
  );

  const code = Math.floor(1000 + Math.random() * 9000).toString();
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

  const record = await OTP.create({
    appointmentId,
    phone,
    otpCode:            code,
    otpExpiresAt:       expiresAt,
    verificationStatus: 'PENDING',
    attemptCount:       0,
    maxAttempts:        MAX_ATTEMPTS,
  });

  console.log(`[OTP] Generated for appt ${appointmentId} | expires ${expiresAt.toISOString()}`);
  return { record, code };
}

/**
 * Verify an OTP entered by the patient.
 * Returns { success, reason, attemptsRemaining }
 */
async function verifyOTP(appointmentId, enteredCode) {
  const record = await OTP.findOne({
    appointmentId,
    verificationStatus: 'PENDING',
  }).sort({ createdAt: -1 });

  if (!record) return { success: false, reason: 'NOT_FOUND' };

  if (new Date() > record.otpExpiresAt) {
    record.verificationStatus = 'EXPIRED';
    await record.save();
    return { success: false, reason: 'OTP_EXPIRED' };
  }

  if (record.attemptCount >= record.maxAttempts) {
    record.verificationStatus = 'FAILED';
    await record.save();
    return { success: false, reason: 'MAX_ATTEMPTS_EXCEEDED' };
  }

  if (record.otpCode !== enteredCode.toString().trim()) {
    record.attemptCount += 1;
    if (record.attemptCount >= record.maxAttempts) {
      record.verificationStatus = 'FAILED';
    }
    await record.save();
    const attemptsRemaining = record.maxAttempts - record.attemptCount;
    return { success: false, reason: 'WRONG_OTP', attemptsRemaining };
  }

  // Correct
  record.verificationStatus = 'VERIFIED';
  record.verifiedAt          = new Date();
  await record.save();
  return { success: true, reason: 'OTP_VERIFIED' };
}

module.exports = { createOTP, verifyOTP };
