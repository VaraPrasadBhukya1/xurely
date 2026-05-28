// src/services/botLogic.js
'use strict';

const { Patient, Appointment, Doctor, Clinic, SupportTicket } = require('../models');
const { sendText, sendButtons, sendUrlButton } = require('./whatsapp');
const { createOTP, verifyOTP } = require('./otp');
const { createOrder } = require('./payment');
const T = require('./templates');
const clinicData = require('../../config/clinicData');

// ── SESSION STORE (in-process Map — swap for Redis at >1 dyno/worker) ─────────
const sessions  = new Map();
const SESSION_TTL = 30 * 60 * 1000; // 30 min

function getSession(phone) {
  const s = sessions.get(phone);
  if (s && Date.now() - s.lastActivity < SESSION_TTL) return s;
  if (s) sessions.delete(phone); // expired — clean up
  return null;
}
function setSession(phone, data) {
  // A fresh interaction clears any pending inactivity flags.
  sessions.set(phone, { ...data, lastActivity: Date.now(), nudged: false, paused: false });
}
function clearSession(phone) {
  sessions.delete(phone);
}

// ── CLINIC CACHE (avoids hitting DB on every booking) ─────────────────────────
let _clinicDoc = null;
async function getClinic() {
  if (_clinicDoc) return _clinicDoc;
  _clinicDoc = await Clinic.findOne({ name: clinicData.clinic.name }).lean();
  if (!_clinicDoc) throw new Error('Clinic not found in DB — run: node src/utils/setupDb.js');
  return _clinicDoc;
}

// Map display slot index → { label, hour24, dayOffset } (dayOffset: days from today)
const SLOTS = [
  { label: '10:00 AM', hour24: 10, dayOffset: 1 },
  { label: '2:30 PM',  hour24: 14, dayOffset: 1 },
  { label: '9:00 AM',  hour24:  9, dayOffset: 2 },
];

// The actual calendar date for a slot (today + dayOffset).
function slotDate(dayOffset) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  return d;
}
// Compact date label e.g. "29 May" — kept short to fit Whapi's 20-char button limit.
function slotDateLabel(dayOffset) {
  return slotDate(dayOffset).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
// Build the slot buttons with a time + date title, e.g. "10:00 AM · 29 May".
function buildSlotButtons() {
  return SLOTS.map((s, i) => ({ id: `slot_${i}`, title: `${s.label} · ${slotDateLabel(s.dayOffset)}` }));
}

// Phrases that trigger the on-arrival check-in flow.
const CHECK_IN_TRIGGERS = ['here', 'arrived', 'checkin', 'check in', "i'm here", 'im here', 'present'];

// Steps where the user is typing free text — check-in triggers must NOT fire here,
// otherwise a question containing "here" would hijack the conversation.
const FREE_TEXT_STEPS = ['AWAITING_NAME', 'AWAITING_QUESTION', 'AWAITING_GENERAL_ENQUIRY'];

// Steps where an idle user should be nudged after a few minutes.
const NUDGEABLE_STEPS = ['AWAITING_ENQUIRY_TYPE', 'AWAITING_NAME', 'AWAITING_DOCTOR', 'AWAITING_SLOT'];

// ── NAME PARSING / VALIDATION ────────────────────────────────────────────────
// Strip dangerous chars and cap length.
function sanitise(str) {
  return str.replace(/[<>'";&]/g, '').trim().slice(0, 100);
}
// Pull the name out of phrases like "My name is Priya Sharma" / "I'm Priya".
function parseName(raw) {
  let s = sanitise(raw);
  s = s.replace(/^(hi|hello|hey)[,!.\s]+/i, '');
  s = s.replace(/^(my\s+name(?:'?s| is)?|i\s*am|i'?m|this\s+is|it'?s|call\s+me|name)\b[:\s]*/i, '').trim();
  return s;
}
function isValidName(s) {
  // ≥2 chars, contains a letter, and only letters/spaces/.'- (rejects "123", "!!!", "xyzabc12").
  return s.length >= 2 && /[a-zA-Z]/.test(s) && /^[a-zA-Z][a-zA-Z .'-]*$/.test(s);
}
function firstName(s) {
  return (s || '').trim().split(/\s+/)[0] || '';
}

// ── MAIN ENTRY ─────────────────────────────────────────────────────────────────
async function handleInbound(phone, rawText) {
  const msg   = rawText.trim();
  const lower = msg.toLowerCase();

  console.log(`[BOT] ← ${phone}: "${msg}"`);

  // Global commands — always work regardless of session state
  if (['hi', 'hello', 'hey', 'start', 'menu'].includes(lower)) {
    clearSession(phone);
    return sendMain(phone);
  }
  if (['cancel', 'stop'].includes(lower)) {
    clearSession(phone);
    return sendText(phone, 'No problem! Session cleared. Say *Hi* anytime to start again. 💚');
  }
  if (lower === 'late') {
    return sendText(phone, `Got it! Please call us at ${clinicData.clinic.phone} and we'll reschedule you. 💚`);
  }
  if (lower === 'rebook') {
    clearSession(phone);
    return sendMain(phone);
  }

  const session = getSession(phone);

  // Check-in triggers — but never while the user is typing free text.
  const collectingFreeText = session && FREE_TEXT_STEPS.includes(session.step);
  if (!collectingFreeText && CHECK_IN_TRIGGERS.some(t => lower.includes(t))) {
    return startCheckIn(phone);
  }

  if (!session) return sendMain(phone);

  switch (session.step) {
    case 'AWAITING_ENQUIRY_TYPE':    return handleEnquiryType(phone, msg, session);
    case 'AWAITING_NAME':            return handleName(phone, msg, session);
    case 'AWAITING_DOCTOR':          return handleDoctorChoice(phone, msg, session);
    case 'AWAITING_SLOT':            return handleSlotChoice(phone, msg, session);
    case 'AWAITING_QUESTION':        return handleQuestion(phone, msg, session);
    case 'AWAITING_GENERAL_ENQUIRY': return handleGeneralEnquiry(phone, msg, session);
    case 'AWAITING_CHECKIN_PHONE':   return handleCheckInPhone(phone, msg, session);
    case 'AWAITING_OTP':             return handleOTPInput(phone, msg, session);
    case 'AWAITING_REVIEW':          return handleReview(phone, msg, session);
    case 'PAYMENT_PENDING':
      // Patient messaged while waiting for payment — nudge them
      return sendText(phone,
        `Your payment link is still open 💳 Complete it to confirm your slot, or reply *CANCEL* to start over.`
      );
    default:
      clearSession(phone);
      return sendMain(phone);
  }
}

// ── STAGE 1: GREETING + ENQUIRY TYPE ────────────────────────────────────────────
async function sendMain(phone) {
  // Stage 0: DB check — is this a returning patient?
  let name = null;
  try {
    const patient = await Patient.findOne({ phone }).lean();
    if (patient?.name) name = firstName(patient.name);
  } catch (err) {
    console.error('[BOT] sendMain lookup error:', err.message);
  }

  setSession(phone, { step: 'AWAITING_ENQUIRY_TYPE', patientName: name });

  return sendButtons(phone, T.greeting(clinicData.clinic.name, name), [
    { id: 'enquiry_book',    title: '📅 Book Appointment' },
    { id: 'enquiry_ask',     title: '❓ Ask a Question' },
    { id: 'enquiry_general', title: '💬 General Enquiry' },
  ], { messageType: 'MAIN_MENU' });
}

function enquiryButtons() {
  return [
    { id: 'enquiry_book',    title: '📅 Book Appointment' },
    { id: 'enquiry_ask',     title: '❓ Ask a Question' },
    { id: 'enquiry_general', title: '💬 General Enquiry' },
  ];
}

async function handleEnquiryType(phone, msg, session) {
  const m = msg.toLowerCase();
  let type = null;

  if (m.startsWith('enquiry_')) {
    type = m.replace('enquiry_', '');
  } else if (/book|appoint/.test(m) || m === '1') {
    type = 'book';
  } else if (/question|^ask/.test(m) || m === '2') {
    type = 'ask';
  } else if (/general|other|enquir|inquir/.test(m) || m === '3') {
    type = 'general';
  }

  const map = { book: 'BOOKING', ask: 'QUESTION', general: 'GENERAL' };
  const enquiryType = map[type];
  if (!enquiryType) {
    return sendButtons(phone, 'Please choose one of the options below:', enquiryButtons());
  }

  // Stage 2: conditional name collection
  if (!session.patientName) {
    setSession(phone, { ...session, step: 'AWAITING_NAME', enquiryType });
    return sendText(phone, T.namePrompt(), { messageType: 'NAME_PROMPT' });
  }

  setSession(phone, { ...session, enquiryType });
  return routeEnquiry(phone, getSession(phone));
}

// ── STAGE 2: NAME COLLECTION (only for new patients) ────────────────────────────
async function handleName(phone, msg, session) {
  const parsed = parseName(msg);
  if (!isValidName(parsed)) {
    return sendText(phone, T.invalidName(), { messageType: 'NAME_INVALID' });
  }

  const fullName = parsed;
  try {
    const clinic = await getClinic();
    await Patient.findOneAndUpdate(
      { phone },
      { $set: { name: fullName, clinicId: clinic._id, phone } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (err) {
    console.error('[BOT] handleName upsert error:', err.message);
  }

  setSession(phone, { ...session, patientName: firstName(fullName), patientFullName: fullName });
  return routeEnquiry(phone, getSession(phone));
}

// ── STAGE 3: ROUTE BY ENQUIRY TYPE ──────────────────────────────────────────────
async function routeEnquiry(phone, session) {
  switch (session.enquiryType) {
    case 'BOOKING':
      return startBooking(phone, session);
    case 'QUESTION':
      setSession(phone, { ...session, step: 'AWAITING_QUESTION' });
      return sendText(phone, T.askPrompt(session.patientName), { messageType: 'ASK_PROMPT' });
    case 'GENERAL':
      setSession(phone, { ...session, step: 'AWAITING_GENERAL_ENQUIRY' });
      return sendText(phone, T.generalPrompt(session.patientName), { messageType: 'GENERAL_PROMPT' });
    default:
      clearSession(phone);
      return sendMain(phone);
  }
}

// ── BRANCH A: BOOKING ────────────────────────────────────────────────────────────
async function startBooking(phone, session) {
  setSession(phone, { ...session, step: 'AWAITING_DOCTOR' });

  const buttons = clinicData.doctors.slice(0, 3).map((d, i) => ({
    id: `doctor_${i}`, title: d.name.replace('Dr. ', 'Dr.').slice(0, 20),
  }));

  return sendButtons(phone, T.bookingDoctorPrompt(session.patientName), buttons, { messageType: 'DOCTOR_MENU' });
}

async function handleDoctorChoice(phone, msg, session) {
  // Button replies come as the button ID e.g. "doctor_0"; plain-text fallback: "1","2","3"
  let idx = -1;
  if (msg.startsWith('doctor_')) {
    idx = parseInt(msg.replace('doctor_', ''), 10);
  } else {
    idx = parseInt(msg, 10) - 1;
  }

  if (isNaN(idx) || idx < 0 || idx >= clinicData.doctors.length) {
    const buttons = clinicData.doctors.slice(0, 3).map((d, i) => ({
      id: `doctor_${i}`, title: d.name.replace('Dr. ', 'Dr.').slice(0, 20),
    }));
    return sendButtons(phone, 'Please choose a doctor:', buttons);
  }

  setSession(phone, { ...session, step: 'AWAITING_SLOT', doctorIndex: idx });

  const doctor = clinicData.doctors[idx];
  const body   = `Great! You chose *${doctor.name}* (${doctor.specialty}).\n\nPick a time slot:`;

  return sendButtons(phone, body, buildSlotButtons(), { messageType: 'DOCTOR_CHOSEN' });
}

async function handleSlotChoice(phone, msg, session) {
  // Button reply: "slot_0".."slot_2"; plain-text fallback: "1"/"10:00" etc.
  let slotIdx = -1;
  if (msg.startsWith('slot_')) {
    slotIdx = parseInt(msg.replace('slot_', ''), 10);
  } else {
    const num   = parseInt(msg.trim(), 10);
    const lower = msg.trim().toLowerCase();
    if (num >= 1 && num <= SLOTS.length) {
      slotIdx = num - 1;
    } else {
      slotIdx = SLOTS.findIndex(s => lower.includes(s.label.toLowerCase().split(' ')[0]));
    }
  }

  if (slotIdx < 0 || slotIdx >= SLOTS.length) {
    return sendButtons(phone, 'Please pick a time slot:', buildSlotButtons());
  }

  // Name was already collected/loaded upstream — go straight to booking.
  setSession(phone, { ...session, step: 'PAYMENT_PENDING', slotIdx });
  return finalizeBooking(phone, getSession(phone));
}

// ── CREATE APPOINTMENT + SEND PAYMENT ────────────────────────────────────────────
async function finalizeBooking(phone, session) {
  try {
    const clinic = await getClinic();
    const doctor = clinicData.doctors[session.doctorIndex];

    // Upsert patient (name is known by now — from DB or collected in Stage 2)
    const patientName = session.patientFullName || session.patientName;
    const patient = await Patient.findOneAndUpdate(
      { phone },
      { $set: { name: patientName, clinicId: clinic._id, phone } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const dbDoctor = await Doctor.findOne({ name: doctor.name, clinicId: clinic._id }).lean();
    if (!dbDoctor) throw new Error(`Doctor not found: ${doctor.name}`);

    const slot   = SLOTS[session.slotIdx];
    const apptDt = slotDate(slot.dayOffset);
    apptDt.setHours(slot.hour24, 0, 0, 0);

    const appointment = await Appointment.create({
      appointmentId:       `APT-${Date.now()}`,
      clinicId:            clinic._id,
      patientId:           patient._id,
      doctorId:            dbDoctor._id,
      appointmentDatetime: apptDt,
      status:              'PENDING',
      paymentStatus:       'PENDING',
    });

    setSession(phone, {
      ...getSession(phone),
      appointmentId: appointment._id.toString(),
      patientId:     patient._id.toString(),
    });

    let paymentLink = null;
    try {
      const order = await createOrder(appointment._id, patient._id, patientName, phone, patient.email);
      paymentLink = order.paymentLink || null;
    } catch (payErr) {
      console.error('[PAYMENT] Order creation failed:', payErr.message);
    }

    const dateLabel = slotDateLabel(slot.dayOffset);

    if (paymentLink) {
      // One combined message: slot reserved + Pay Now button.
      await sendUrlButton(phone, T.payPrompt(doctor.name, slot.label, dateLabel), 'Pay Now ₹999', paymentLink, {
        appointmentId: appointment._id,
        patientId:     patient._id,
        messageType:   'PAYMENT_LINK',
      });
    } else {
      await sendText(phone, T.payPromptNoLink(doctor.name, slot.label, clinicData.clinic.phone), {
        appointmentId: appointment._id,
        patientId:     patient._id,
        messageType:   'PAYMENT_LINK',
      });
    }

  } catch (err) {
    console.error('[BOT] finalizeBooking error:', err.message);
    clearSession(phone);
    await sendText(phone,
      `Sorry, something went wrong on our end. Please call us at ${clinicData.clinic.phone} to book. 🙏`
    );
  }
}

// ── BRANCH B: ASK A QUESTION (FAQ keyword routing) ──────────────────────────────
async function handleQuestion(phone, msg, session) {
  const q    = msg.toLowerCase();
  const name = session.patientName || 'there';

  // Let the user jump straight into booking from a follow-up button / "book".
  if (q.startsWith('enquiry_book') || q === 'book') {
    return startBooking(phone, { ...session, enquiryType: 'BOOKING' });
  }

  let answer = null;
  if (/hour|timing|\bopen\b|\bclose|when.*(open|close)/.test(q)) {
    answer = T.faqHours(clinicData.clinic.name, clinicData.hours.weekday, clinicData.hours.sunday);
  } else if (/cost|price|fee|charge|\brate\b|how much/.test(q)) {
    answer = T.faqPricing(clinicData.pricing);
  } else if (/implant|orthodont|brace|aligner|treat|clean|whiten|root\s*canal|cavity|filling|crown|cosmetic/.test(q)) {
    answer = T.faqTreatments(clinicData.treatments);
  } else if (/address|location|direction|\bwhere\b|reach|\bmap/.test(q)) {
    answer = T.clinicAddress(clinicData.clinic.name, clinicData.clinic.address, clinicData.clinic.googleMapsUrl);
  }

  if (answer) {
    await sendText(phone, answer, { messageType: 'FAQ_ANSWER' });
    // Stay in the question loop and offer a quick path to booking.
    setSession(phone, { ...session, step: 'AWAITING_QUESTION' });
    return sendButtons(phone, 'Anything else I can help with?', [
      { id: 'enquiry_book', title: '📅 Book Appointment' },
      { id: 'menu',         title: '🏠 Main Menu' },
    ], { messageType: 'FAQ_FOLLOWUP' });
  }

  // Couldn't answer → hand off to a human.
  await createSupportTicket(phone, session, 'QUESTION', msg);
  clearSession(phone);
  return sendText(phone, T.supportHandoff(), { messageType: 'SUPPORT_HANDOFF' });
}

// ── BRANCH C: GENERAL ENQUIRY (free-text capture) ───────────────────────────────
async function handleGeneralEnquiry(phone, msg, session) {
  const t    = msg.toLowerCase();
  const name = session.patientName || 'there';

  // Symptoms → suggest booking
  if (/pain|ache|decay|bleed|swollen|swelling|broke|broken|sensitiv|emergenc|urgent|cavity/.test(t)) {
    await createSupportTicket(phone, session, 'GENERAL', msg, 'URGENT');
    await sendText(phone, T.symptomBookingNudge(name), { messageType: 'SYMPTOM_NUDGE' });
    return startBooking(phone, { ...session, enquiryType: 'BOOKING' });
  }

  // Clinic info → send address + maps
  if (/address|location|direction|\bwhere\b|reach|\bmap/.test(t)) {
    await createSupportTicket(phone, session, 'GENERAL', msg);
    clearSession(phone);
    return sendText(phone,
      T.clinicAddress(clinicData.clinic.name, clinicData.clinic.address, clinicData.clinic.googleMapsUrl),
      { messageType: 'CLINIC_ADDRESS' }
    );
  }

  // Otherwise → acknowledge + hand off to a human
  await createSupportTicket(phone, session, 'GENERAL', msg);
  clearSession(phone);
  await sendText(phone, T.generalAck(name), { messageType: 'GENERAL_ACK' });
  return sendText(phone, T.supportHandoff(), { messageType: 'SUPPORT_HANDOFF' });
}

// ── SUPPORT HANDOFF ──────────────────────────────────────────────────────────────
async function createSupportTicket(phone, session, category, text, priority = 'NORMAL') {
  try {
    const clinic  = await getClinic();
    const patient = await Patient.findOne({ phone }).lean();
    await SupportTicket.create({
      clinicId:          clinic._id,
      patientId:         patient?._id || null,
      phone,
      name:              session.patientFullName || session.patientName || patient?.name || null,
      category,
      priority,
      enquiryText:       text,
      conversationState: session.step,
      status:            'OPEN',
    });
    console.log(`[SUPPORT] ticket created: ${phone} (${category}/${priority})`);
  } catch (err) {
    console.error('[BOT] createSupportTicket error:', err.message);
  }
}

// ── CHECK-IN FLOW ──────────────────────────────────────────────────────────────
async function startCheckIn(phone) {
  try {
    const patient = await Patient.findOne({ phone });
    if (!patient) {
      return sendText(phone,
        `We couldn't find your booking. Please call us at ${clinicData.clinic.phone}. 📞`
      );
    }

    const appt = await Appointment.findOne({
      patientId:     patient._id,
      status:        'CONFIRMED',
      paymentStatus: 'SUCCESS',
    }).sort({ appointmentDatetime: -1 });

    if (!appt) {
      return sendText(phone,
        `No confirmed appointment found. Please call us at ${clinicData.clinic.phone}. 📞`
      );
    }

    setSession(phone, {
      step:          'AWAITING_CHECKIN_PHONE',
      appointmentId: appt._id.toString(),
    });

    await Appointment.findByIdAndUpdate(appt._id, {
      checkInStatus:      'PENDING',
      checkInInitiatedAt: new Date(),
    });

    return sendText(phone, T.checkInRequest(clinicData.clinic.name), {
      appointmentId: appt._id,
      patientId:     patient._id,
      messageType:   'CHECKIN_REQUEST',
    });
  } catch (err) {
    console.error('[BOT] startCheckIn error:', err.message);
  }
}

async function handleCheckInPhone(phone, msg, session) {
  const digits = msg.replace(/\D/g, '');
  if (digits.length !== 10) {
    return sendText(phone, 'Please send your *10-digit* mobile number.\nExample: 9876543210');
  }

  try {
    const { code } = await createOTP(session.appointmentId, phone);
    setSession(phone, { ...session, step: 'AWAITING_OTP' });
    const patient = await Patient.findOne({ phone }).lean();
    return sendText(phone, T.otpSent(code), {
      appointmentId: session.appointmentId,
      patientId:     patient?._id,
      messageType:   'OTP_SENT',
    });
  } catch (err) {
    console.error('[BOT] handleCheckInPhone error:', err.message);
    clearSession(phone);
    return sendText(phone, `Something went wrong. Please call us at ${clinicData.clinic.phone}. 📞`);
  }
}

async function handleOTPInput(phone, msg, session) {
  try {
    const result  = await verifyOTP(session.appointmentId, msg.trim());
    const patient = await Patient.findOne({ phone }).lean();

    if (result.success) {
      await Appointment.findByIdAndUpdate(session.appointmentId, {
        checkInStatus:         'VERIFIED',
        attendanceConfirmed:   true,
        checkInVerifiedAt:     new Date(),
        attendanceConfirmedAt: new Date(),
      });
      clearSession(phone);
      return sendText(phone, T.attendanceConfirmed(3, '15-20'), {
        appointmentId: session.appointmentId,
        patientId:     patient?._id,
        messageType:   'ATTENDANCE_CONFIRMED',
      });
    }

    if (result.reason === 'WRONG_OTP') {
      return sendText(phone, T.otpWrong(result.attemptsRemaining), { messageType: 'OTP_WRONG' });
    }
    if (result.reason === 'OTP_EXPIRED') {
      clearSession(phone);
      return sendText(phone, T.otpExpired(), { messageType: 'OTP_EXPIRED' });
    }

    // MAX_ATTEMPTS_EXCEEDED or unknown
    clearSession(phone);
    return sendText(phone,
      `Verification failed. Please call us at ${clinicData.clinic.phone} to check in. 📞`
    );
  } catch (err) {
    console.error('[BOT] handleOTPInput error:', err.message);
    clearSession(phone);
    return sendText(phone, `Something went wrong. Please call us at ${clinicData.clinic.phone}. 📞`);
  }
}

// ── REVIEW FLOW ────────────────────────────────────────────────────────────────
async function startReview(phone, appointmentId) {
  try {
    const appt = await Appointment.findById(appointmentId).populate('doctorId').lean();
    if (!appt?.doctorId) return;

    setSession(phone, {
      step:          'AWAITING_REVIEW',
      appointmentId: appointmentId.toString(),
    });

    return sendText(phone, T.reviewRequest(appt.doctorId.name), { messageType: 'REVIEW_REQUEST' });
  } catch (err) {
    console.error('[BOT] startReview error:', err.message);
  }
}

async function handleReview(phone, msg, session) {
  const rating = parseInt(msg.trim().charAt(0), 10);
  if (!rating || rating < 1 || rating > 5) {
    return sendText(phone, 'Please reply with a number from *1* to *5*. ⭐');
  }

  try {
    await Appointment.findByIdAndUpdate(session.appointmentId, {
      reviewRating:   rating,
      reviewRoutedTo: rating >= 4 ? 'GOOGLE' : 'PRIVATE',
    });
    clearSession(phone);

    return rating >= 4
      ? sendText(phone, T.reviewThankYouHigh(clinicData.clinic.googleMapsUrl), { messageType: 'REVIEW_HIGH' })
      : sendText(phone, T.reviewThankYouLow(clinicData.clinic.phone), { messageType: 'REVIEW_LOW' });
  } catch (err) {
    console.error('[BOT] handleReview error:', err.message);
    clearSession(phone);
  }
}

// ── INACTIVITY SWEEPER ───────────────────────────────────────────────────────────
// Nudges idle users mid-flow, then gracefully pauses the chat. (Spec: Stage timeout.)
const NUDGE_AFTER = 5  * 60 * 1000; // 5 min idle → gentle reminder
const PAUSE_AFTER = 25 * 60 * 1000; // 25 min idle → "I'll keep your chat open" (before 30-min TTL)

function sweepInactiveSessions() {
  const now = Date.now();
  for (const [phone, s] of sessions) {
    if (!NUDGEABLE_STEPS.includes(s.step)) continue;
    const idle = now - s.lastActivity;

    if (idle >= PAUSE_AFTER && !s.paused) {
      s.paused = true;
      sendText(phone, T.inactivityPaused(clinicData.clinic.phone), { messageType: 'INACTIVITY_PAUSED' }).catch(() => {});
    } else if (idle >= NUDGE_AFTER && !s.nudged) {
      s.nudged = true;
      sendText(phone, T.inactivityNudge(s.patientName), { messageType: 'INACTIVITY_NUDGE' }).catch(() => {});
    }
  }
}

function startInactivitySweeper() {
  if (global.__xurelySweeper) return;
  const iv = setInterval(sweepInactiveSessions, 60 * 1000);
  if (iv.unref) iv.unref(); // don't keep the process alive for this alone
  global.__xurelySweeper = iv;
}
startInactivitySweeper();

module.exports = { handleInbound, startCheckIn, startReview };
