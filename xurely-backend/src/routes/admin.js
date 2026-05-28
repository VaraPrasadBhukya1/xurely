// src/routes/admin.js
const express    = require('express');
const router     = express.Router();
const { Appointment, Patient, Doctor, Clinic, Review, SupportTicket } = require('../models');
const { startReview }  = require('../services/botLogic');
const { sendText }     = require('../services/whatsapp');
const T                = require('../services/templates');
const clinicData       = require('../../config/clinicData');

// Simple API key auth for admin routes
const adminAuth = (req, res, next) => {
  const key = req.headers['x-admin-key'];
  if (key && key === process.env.ADMIN_API_KEY) return next();
  res.sendStatus(401);
};

// GET /api/admin/appointments
router.get('/appointments', adminAuth, async (req, res) => {
  const { status, date } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (date) {
    const d = new Date(date);
    filter.appointmentDatetime = {
      $gte: new Date(d.setHours(0, 0, 0, 0)),
      $lt:  new Date(d.setHours(23, 59, 59, 999)),
    };
  }
  const appts = await Appointment.find(filter)
    .populate('patientId doctorId')
    .sort({ appointmentDatetime: 1 })
    .limit(100);
  res.json(appts);
});

// POST /api/admin/appointments/:id/complete
router.post('/appointments/:id/complete', adminAuth, async (req, res) => {
  const appt = await Appointment.findByIdAndUpdate(
    req.params.id,
    { status: 'COMPLETED' },
    { new: true }
  ).populate('patientId');

  if (!appt) return res.status(404).json({ error: 'Not found' });

  // Trigger review request
  await startReview(appt.patientId.phone, appt._id);
  res.json({ success: true, appt });
});

// POST /api/admin/send-message — manual WhatsApp send
router.post('/send-message', adminAuth, async (req, res) => {
  const { phone, message } = req.body;
  if (!phone || !message) return res.status(400).json({ error: 'phone and message required' });
  const result = await sendText(phone, message, { messageType: 'MANUAL' });
  res.json(result);
});

// GET /api/admin/support-tickets — handoff queue (newest first; URGENT prioritised)
router.get('/support-tickets', adminAuth, async (req, res) => {
  const { status = 'OPEN' } = req.query;
  const filter = status === 'ALL' ? {} : { status };
  const tickets = await SupportTicket.find(filter)
    .populate('patientId')
    .sort({ priority: -1, createdAt: -1 }) // URGENT before NORMAL
    .limit(100);
  res.json(tickets);
});

// POST /api/admin/support-tickets/:id/status — update ticket status
router.post('/support-tickets/:id/status', adminAuth, async (req, res) => {
  const { status } = req.body;
  if (!['OPEN', 'IN_PROGRESS', 'CLOSED'].includes(status)) {
    return res.status(400).json({ error: 'status must be OPEN, IN_PROGRESS or CLOSED' });
  }
  const ticket = await SupportTicket.findByIdAndUpdate(req.params.id, { status }, { new: true });
  if (!ticket) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true, ticket });
});

// GET /api/admin/stats
router.get('/stats', adminAuth, async (req, res) => {
  const [totalAppts, confirmed, completed, noShow, totalPatients, reviews] = await Promise.all([
    Appointment.countDocuments(),
    Appointment.countDocuments({ status: 'CONFIRMED' }),
    Appointment.countDocuments({ status: 'COMPLETED' }),
    Appointment.countDocuments({ status: 'NO_SHOW' }),
    Patient.countDocuments(),
    Appointment.aggregate([{ $group: { _id: null, avg: { $avg: '$reviewRating' } } }]),
  ]);

  res.json({
    appointments: { total: totalAppts, confirmed, completed, noShow },
    patients: totalPatients,
    avgRating: reviews[0]?.avg?.toFixed(1) || 'N/A',
  });
});

module.exports = router;
