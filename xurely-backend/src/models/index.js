// src/models/index.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

// ── CLINIC ──────────────────────────────────────────────────────────────────
const ClinicSchema = new Schema({
  name:          { type: String, required: true, unique: true },
  city:          { type: String, required: true },
  address:       { type: String, required: true },
  phone:         { type: String, required: true },
  email:         String,
  website:       String,
  latitude:      Number,
  longitude:     Number,
  googleMapsUrl: String,
}, { timestamps: true });

// ── DOCTOR ──────────────────────────────────────────────────────────────────
const DoctorSchema = new Schema({
  clinicId:      { type: Schema.Types.ObjectId, ref: 'Clinic', required: true },
  name:          { type: String, required: true },
  specialty:     String,
  qualification: String,
  phone:         String,
  isActive:      { type: Boolean, default: true },
}, { timestamps: true });

// ── PATIENT ──────────────────────────────────────────────────────────────────
const PatientSchema = new Schema({
  clinicId:       { type: Schema.Types.ObjectId, ref: 'Clinic', required: true },
  phone:          { type: String, required: true, unique: true },
  name:           { type: String, required: true },
  email:          String,
  age:            Number,
  gender:         String,
  address:        String,
  medicalHistory: String,
}, { timestamps: true });

// ── APPOINTMENT ──────────────────────────────────────────────────────────────
const AppointmentSchema = new Schema({
  appointmentId:        { type: String, unique: true, required: true },
  clinicId:             { type: Schema.Types.ObjectId, ref: 'Clinic',  required: true },
  patientId:            { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
  doctorId:             { type: Schema.Types.ObjectId, ref: 'Doctor',  required: true },
  appointmentDatetime:  { type: Date, required: true },
  status:               { type: String, enum: ['PENDING','CONFIRMED','COMPLETED','CANCELLED','NO_SHOW'], default: 'PENDING' },
  paymentStatus:        { type: String, enum: ['PENDING','SUCCESS','FAILED','EXPIRED'], default: 'PENDING' },
  checkInStatus:        { type: String, enum: ['NOT_INITIATED','PENDING','VERIFIED','SKIPPED'], default: 'NOT_INITIATED' },
  attendanceConfirmed:  { type: Boolean, default: false },
  checkInInitiatedAt:   Date,
  checkInVerifiedAt:    Date,
  attendanceConfirmedAt:Date,
  slotHoldExpiresAt:    Date,
  reminder24hSent:      { type: Boolean, default: false },
  reminder24hSentAt:    Date,
  reminder2hSent:       { type: Boolean, default: false },
  reminder2hSentAt:     Date,
  reviewRating:         Number,
  reviewRoutedTo:       { type: String, enum: ['GOOGLE','PRIVATE','NONE'], default: 'NONE' },
  reactivationSent:     { type: Boolean, default: false },
  reactivationSentAt:   Date,
}, { timestamps: true });

AppointmentSchema.index({ appointmentDatetime: 1 });
AppointmentSchema.index({ status: 1 });
AppointmentSchema.index({ paymentStatus: 1 });

// ── OTP VERIFICATION ─────────────────────────────────────────────────────────
const OTPSchema = new Schema({
  appointmentId:      { type: Schema.Types.ObjectId, ref: 'Appointment', required: true },
  phone:              { type: String, required: true },
  otpCode:            { type: String, required: true },
  otpExpiresAt:       { type: Date, required: true },
  verificationStatus: { type: String, enum: ['PENDING','VERIFIED','EXPIRED','FAILED'], default: 'PENDING' },
  verifiedAt:         Date,
  attemptCount:       { type: Number, default: 0 },
  maxAttempts:        { type: Number, default: 3 },
}, { timestamps: true });

OTPSchema.index({ otpExpiresAt: 1 }, { expireAfterSeconds: 0 }); // auto-delete expired

// ── PAYMENT TRANSACTION ──────────────────────────────────────────────────────
const PaymentSchema = new Schema({
  appointmentId:      { type: Schema.Types.ObjectId, ref: 'Appointment', required: true },
  patientId:          { type: Schema.Types.ObjectId, ref: 'Patient',     required: true },
  amountOriginal:     Number,
  discountPercent:    Number,
  discountAmount:     Number,
  amountFinal:        Number,
  paymentGateway:     { type: String, default: 'CASHFREE' },
  cashfreeOrderId:    { type: String, unique: true, sparse: true },
  cashfreePaymentId:  String,
  paymentStatus:      { type: String, enum: ['PENDING','SUCCESS','FAILED','CANCELLED'], default: 'PENDING' },
  paidAt:             Date,
}, { timestamps: true });

// ── WHATSAPP MESSAGE LOG ──────────────────────────────────────────────────────
const WAMessageSchema = new Schema({
  appointmentId: { type: Schema.Types.ObjectId, ref: 'Appointment' },
  patientId:     { type: Schema.Types.ObjectId, ref: 'Patient' },
  phone:         String,
  messageType:   String,
  messageBody:   String,
  direction:     { type: String, enum: ['INBOUND','OUTBOUND'], default: 'OUTBOUND' },
  status:        { type: String, enum: ['PENDING','SENT','FAILED','DELIVERED'], default: 'PENDING' },
  wamid:         String,
  sentAt:        Date,
  deliveredAt:   Date,
}, { timestamps: true });

// ── REVIEW ────────────────────────────────────────────────────────────────────
const ReviewSchema = new Schema({
  appointmentId: { type: Schema.Types.ObjectId, ref: 'Appointment', required: true },
  patientId:     { type: Schema.Types.ObjectId, ref: 'Patient',     required: true },
  doctorId:      { type: Schema.Types.ObjectId, ref: 'Doctor',      required: true },
  rating:        Number,
  reviewText:    String,
  routedTo:      { type: String, enum: ['GOOGLE','PRIVATE','NONE'], default: 'NONE' },
  isPublic:      { type: Boolean, default: false },
}, { timestamps: true });

// ── SUPPORT TICKET ─────────────────────────────────────────────────────────────
// Raised when the bot can't answer a question or a free-text enquiry needs a human.
const SupportTicketSchema = new Schema({
  clinicId:          { type: Schema.Types.ObjectId, ref: 'Clinic', required: true },
  patientId:         { type: Schema.Types.ObjectId, ref: 'Patient' },
  phone:             { type: String, required: true },
  name:              String,
  category:          { type: String, enum: ['QUESTION','GENERAL','UNKNOWN'], default: 'UNKNOWN' },
  priority:          { type: String, enum: ['NORMAL','URGENT'], default: 'NORMAL' },
  enquiryText:       String,
  conversationState: String,
  status:            { type: String, enum: ['OPEN','IN_PROGRESS','CLOSED'], default: 'OPEN' },
}, { timestamps: true });

SupportTicketSchema.index({ status: 1, priority: 1 });

module.exports = {
  Clinic:        mongoose.model('Clinic',        ClinicSchema),
  Doctor:        mongoose.model('Doctor',        DoctorSchema),
  Patient:       mongoose.model('Patient',       PatientSchema),
  Appointment:   mongoose.model('Appointment',   AppointmentSchema),
  OTP:           mongoose.model('OTP',           OTPSchema),
  Payment:       mongoose.model('Payment',       PaymentSchema),
  WAMessage:     mongoose.model('WAMessage',     WAMessageSchema),
  Review:        mongoose.model('Review',        ReviewSchema),
  SupportTicket: mongoose.model('SupportTicket', SupportTicketSchema),
};
