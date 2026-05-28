// src/services/reminders.js
'use strict';

const cron       = require('node-cron');
const { Appointment } = require('../models');
const { sendText }    = require('./whatsapp');
const T               = require('./templates');
const clinicData      = require('../../config/clinicData');

// Note: startReview is inlined here to avoid a circular dependency
// (botLogic → reminders would create a cycle)

function startReminders() {
  // Every 5 minutes — lightweight DB queries with indexed fields
  cron.schedule('*/5 * * * *', () => {
    checkReminders().catch(err =>
      console.error('[CRON] Unhandled error in checkReminders:', err.message)
    );
  });
  console.log('[CRON] Reminder scheduler started (interval: every 5 min)');
}

async function checkReminders() {
  await Promise.allSettled([
    send24hReminders(),
    send2hReminders(),
    sendReviewRequests(),
    sendNoShowMessages(),
  ]);
}

// ── 24-HOUR REMINDERS ─────────────────────────────────────────────────────────
async function send24hReminders() {
  const now  = new Date();
  const from = new Date(now.getTime() + 23 * 60 * 60 * 1000);
  const to   = new Date(now.getTime() + 25 * 60 * 60 * 1000);

  const appts = await Appointment.find({
    appointmentDatetime: { $gte: from, $lte: to },
    status:            'CONFIRMED',
    paymentStatus:     'SUCCESS',
    reminder24hSent:   false,
  }).populate('patientId doctorId').lean();

  for (const appt of appts) {
    const patient = appt.patientId;
    const doctor  = appt.doctorId;
    if (!patient?.phone || !doctor?.name) continue;

    const timeSlot = appt.appointmentDatetime.toLocaleTimeString('en-IN', {
      hour: '2-digit', minute: '2-digit', hour12: true,
    });

    try {
      await sendText(patient.phone, T.reminder24h(doctor.name, timeSlot, clinicData.clinic.googleMapsUrl), {
        appointmentId: appt._id,
        patientId:     patient._id,
        messageType:   'REMINDER_24H',
      });
      await Appointment.findByIdAndUpdate(appt._id, {
        reminder24hSent:   true,
        reminder24hSentAt: new Date(),
      });
      console.log(`[REMINDER] 24h → ${patient.phone}`);
    } catch (err) {
      console.error(`[REMINDER] 24h failed for ${patient.phone}:`, err.message);
    }
  }
}

// ── 2-HOUR REMINDERS ──────────────────────────────────────────────────────────
async function send2hReminders() {
  const now  = new Date();
  const from = new Date(now.getTime() + 100 * 60 * 1000);
  const to   = new Date(now.getTime() + 130 * 60 * 1000);

  const appts = await Appointment.find({
    appointmentDatetime: { $gte: from, $lte: to },
    status:           'CONFIRMED',
    paymentStatus:    'SUCCESS',
    reminder2hSent:   false,
  }).populate('patientId doctorId').lean();

  for (const appt of appts) {
    const patient = appt.patientId;
    const doctor  = appt.doctorId;
    if (!patient?.phone || !doctor?.name) continue;

    try {
      await sendText(patient.phone, T.reminder2h(doctor.name, 3, '15-20', clinicData.clinic.googleMapsUrl), {
        appointmentId: appt._id,
        patientId:     patient._id,
        messageType:   'REMINDER_2H',
      });
      await Appointment.findByIdAndUpdate(appt._id, {
        reminder2hSent:   true,
        reminder2hSentAt: new Date(),
      });
      console.log(`[REMINDER] 2h → ${patient.phone}`);
    } catch (err) {
      console.error(`[REMINDER] 2h failed for ${patient.phone}:`, err.message);
    }
  }
}

// ── REVIEW REQUESTS (30-60 min after COMPLETED appointment) ───────────────────
async function sendReviewRequests() {
  const now  = new Date();
  const from = new Date(now.getTime() - 60 * 60 * 1000);
  const to   = new Date(now.getTime() - 20 * 60 * 1000);

  const appts = await Appointment.find({
    appointmentDatetime: { $gte: from, $lte: to },
    status:              'COMPLETED',
    reviewRating:        { $exists: false },
    reviewRoutedTo:      'NONE',
  }).populate('patientId doctorId').lean();

  for (const appt of appts) {
    const patient = appt.patientId;
    const doctor  = appt.doctorId;
    if (!patient?.phone || !doctor?.name) continue;

    try {
      // Import here to break potential future circular dep at module load time
      const { setReviewSession } = require('./botLogic');
      // Inline equivalent since botLogic exports startReview:
      const botLogic = require('./botLogic');
      await botLogic.startReview(patient.phone, appt._id);
      console.log(`[REVIEW] Request → ${patient.phone}`);
    } catch (err) {
      console.error(`[REVIEW] Failed for ${patient.phone}:`, err.message);
    }
  }
}

// ── NO-SHOW DETECTION ─────────────────────────────────────────────────────────
async function sendNoShowMessages() {
  const now  = new Date();
  const from = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const to   = new Date(now.getTime() - 45 * 60 * 1000);

  const appts = await Appointment.find({
    appointmentDatetime:  { $gte: from, $lte: to },
    status:               'CONFIRMED',
    paymentStatus:        'SUCCESS',
    attendanceConfirmed:  false,
  }).populate('patientId doctorId').lean();

  for (const appt of appts) {
    const patient = appt.patientId;
    const doctor  = appt.doctorId;
    if (!patient?.phone || !doctor?.name) continue;

    try {
      await sendText(patient.phone, T.noShow(doctor.name), {
        appointmentId: appt._id,
        patientId:     patient._id,
        messageType:   'NO_SHOW',
      });
      await Appointment.findByIdAndUpdate(appt._id, { status: 'NO_SHOW' });
      console.log(`[NO_SHOW] → ${patient.phone}`);
    } catch (err) {
      console.error(`[NO_SHOW] Failed for ${patient.phone}:`, err.message);
    }
  }
}

module.exports = { startReminders };
