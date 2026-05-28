// src/services/whatsapp.js  — powered by Whapi.cloud
const axios = require('axios');
const { WAMessage } = require('../models');

// Whapi channel URL looks like: https://gate.whapi.cloud/channels/XXXXXXXX
const WHAPI_URL    = process.env.WHAPI_URL;    // e.g. https://gate.whapi.cloud/channels/ABC123
const WHAPI_TOKEN  = process.env.WHAPI_TOKEN;  // your channel token

const headers = () => ({
  'Content-Type': 'application/json',
  Authorization:  `Bearer ${WHAPI_TOKEN}`,
});

/**
 * Send a plain text WhatsApp message via Whapi.
 */
async function sendText(to, body, { appointmentId, patientId, messageType = 'TEXT' } = {}) {
  const phone = normalizePhone(to);

  // Whapi endpoint: POST /messages/text
  const payload = {
    to:   phone,
    body: body,
  };

  let wamid  = null;
  let status = 'PENDING';

  try {
    const { data } = await axios.post(
      `${WHAPI_URL}/messages/text`,
      payload,
      { headers: headers() }
    );
    // Whapi returns: { sent: true, id: "wamid.xxx", ... }
    wamid  = data?.id || null;
    status = data?.sent ? 'SENT' : 'FAILED';
    console.log(`[WA] ✓ Sent to ${phone} | type=${messageType} | id=${wamid}`);
  } catch (err) {
    status = 'FAILED';
    const detail = err.response?.data || err.message;
    console.error(`[WA] ✗ Failed to ${phone}:`, JSON.stringify(detail));
  }

  // Log to DB (non-blocking)
  WAMessage.create({
    appointmentId: appointmentId || null,
    patientId:     patientId     || null,
    phone,
    messageType,
    messageBody:   body,
    direction:     'OUTBOUND',
    status,
    wamid,
    sentAt: status === 'SENT' ? new Date() : null,
  }).catch(() => {});

  return { success: status === 'SENT', wamid };
}

/**
 * Normalize phone to Whapi format: 91XXXXXXXXXX (no + prefix)
 * Whapi expects the number WITHOUT the + sign.
 */
function normalizePhone(raw) {
  const digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('91') && digits.length === 12) return digits;
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

/**
 * Send an interactive button message via Whapi.
 * buttons: [{ id: 'btn_1', title: 'Option A' }, ...]  — max 3 buttons
 */
async function sendButtons(to, body, buttons, { appointmentId, patientId, messageType = 'BUTTONS' } = {}) {
  const phone = normalizePhone(to);

  const payload = {
    to: phone,
    type: 'button',
    body: { text: body },
    action: {
      buttons: buttons.map(b => ({
        type: 'quick_reply',
        title: b.title.slice(0, 20), // Whapi max 20 chars
        id: b.id,
      })),
    },
  };

  let wamid  = null;
  let status = 'PENDING';

  try {
    const { data } = await axios.post(
      `${WHAPI_URL}/messages/interactive`,
      payload,
      { headers: headers() }
    );
    wamid  = data?.id || null;
    status = data?.sent ? 'SENT' : 'FAILED';
    console.log(`[WA] ✓ Buttons sent to ${phone} | type=${messageType} | id=${wamid}`);
  } catch (err) {
    status = 'FAILED';
    const detail = err.response?.data || err.message;
    console.error(`[WA] ✗ Buttons failed to ${phone}:`, JSON.stringify(detail));
    // Fallback to plain text if buttons fail (e.g. unsupported client)
    return sendText(to, body, { appointmentId, patientId, messageType });
  }

  WAMessage.create({
    appointmentId: appointmentId || null,
    patientId:     patientId     || null,
    phone,
    messageType,
    messageBody:   body,
    direction:     'OUTBOUND',
    status,
    wamid,
    sentAt: status === 'SENT' ? new Date() : null,
  }).catch(() => {});

  return { success: status === 'SENT', wamid };
}

/**
 * Send an interactive message with a single URL (CTA) button via Whapi.
 * Opens `url` directly when tapped — used for the "Pay Now" payment link.
 */
async function sendUrlButton(to, body, buttonTitle, url, { appointmentId, patientId, messageType = 'URL_BUTTON' } = {}) {
  const phone = normalizePhone(to);

  const payload = {
    to: phone,
    type: 'button',
    body: { text: body },
    action: {
      buttons: [
        { type: 'url', id: 'pay_now', title: buttonTitle.slice(0, 20), url }, // Whapi max 20 chars
      ],
    },
  };

  let wamid  = null;
  let status = 'PENDING';

  try {
    const { data } = await axios.post(
      `${WHAPI_URL}/messages/interactive`,
      payload,
      { headers: headers() }
    );
    wamid  = data?.id || null;
    status = data?.sent ? 'SENT' : 'FAILED';
    console.log(`[WA] ✓ URL button sent to ${phone} | type=${messageType} | id=${wamid}`);
  } catch (err) {
    status = 'FAILED';
    const detail = err.response?.data || err.message;
    console.error(`[WA] ✗ URL button failed to ${phone}:`, JSON.stringify(detail));
    // Fallback to plain text with the link inline
    return sendText(to, `${body}\n\n${url}`, { appointmentId, patientId, messageType });
  }

  WAMessage.create({
    appointmentId: appointmentId || null,
    patientId:     patientId     || null,
    phone,
    messageType,
    messageBody:   `${body} [${buttonTitle}: ${url}]`,
    direction:     'OUTBOUND',
    status,
    wamid,
    sentAt: status === 'SENT' ? new Date() : null,
  }).catch(() => {});

  return { success: status === 'SENT', wamid };
}

module.exports = { sendText, sendButtons, sendUrlButton, normalizePhone };