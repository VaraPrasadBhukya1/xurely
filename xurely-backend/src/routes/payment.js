// src/routes/payment.js
'use strict';

const express    = require('express');
const router     = express.Router();
const { Appointment, Payment, Patient } = require('../models');
const { verifyOrder, getOrder, IS_PROD } = require('../services/payment');
const { sendText }     = require('../services/whatsapp');
const T                = require('../services/templates');
const clinicData       = require('../../config/clinicData');

// Minimal HTML page shell for the hosted checkout / status pages.
function page(title, bodyHtml) {
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f4f6f8;color:#1f2933;
display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center}
.card{background:#fff;padding:32px 28px;border-radius:14px;box-shadow:0 6px 24px rgba(0,0,0,.08);max-width:340px}
h2{margin:0 0 8px;color:#0f8a5f}p{color:#6b7785;font-size:14px;margin:6px 0}</style>
</head><body><div class="card">${bodyHtml}</div></body></html>`;
}

/**
 * POST /api/payment/webhook
 * CashFree posts here after payment events.
 * ALWAYS re-verify with CashFree API — never trust the posted body alone.
 */
router.post('/webhook', async (req, res) => {
  // Acknowledge immediately — CashFree will retry if it gets anything other than 200
  res.sendStatus(200);

  try {
    const order_id = req.body?.data?.order?.order_id || req.body?.order_id;
    if (!order_id) {
      console.warn('[PAYMENT WEBHOOK] Missing order_id in body:', JSON.stringify(req.body));
      return;
    }

    console.log(`[PAYMENT WEBHOOK] Received for order_id=${order_id}`);

    const result = await verifyOrder(order_id);

    if (result.paymentStatus !== 'SUCCESS') {
      console.log(`[PAYMENT WEBHOOK] Order ${order_id} status=${result.paymentStatus} — no action`);
      return;
    }

    if (result.alreadyProcessed) {
      console.log(`[PAYMENT WEBHOOK] Order ${order_id} already processed — skipping duplicate`);
      return;
    }

    // Fetch payment → appointment → patient → doctor
    const payment = await Payment.findOne({ cashfreeOrderId: order_id });
    if (!payment) {
      console.error(`[PAYMENT WEBHOOK] No Payment record for order_id=${order_id}`);
      return;
    }

    const appt = await Appointment.findById(payment.appointmentId)
      .populate('patientId')
      .populate('doctorId');

    if (!appt) {
      console.error(`[PAYMENT WEBHOOK] No Appointment for payment ${payment._id}`);
      return;
    }

    // Guard: don't double-confirm
    if (appt.paymentStatus === 'SUCCESS') {
      console.log(`[PAYMENT WEBHOOK] Appointment ${appt._id} already confirmed — skipping`);
      return;
    }

    await Appointment.findByIdAndUpdate(appt._id, {
      status:        'CONFIRMED',
      paymentStatus: 'SUCCESS',
    });

    const patient = appt.patientId;
    const doctor  = appt.doctorId;

    if (!patient?.phone) {
      console.error(`[PAYMENT WEBHOOK] No patient phone for appt ${appt._id}`);
      return;
    }

    const timeSlot = appt.appointmentDatetime.toLocaleTimeString('en-IN', {
      hour: '2-digit', minute: '2-digit', hour12: true,
    });
    const date = appt.appointmentDatetime.toLocaleDateString('en-IN', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });

    await sendText(
      patient.phone,
      T.paymentSuccess(
        doctor.name,
        timeSlot,
        date,
        clinicData.clinic.name,
        clinicData.clinic.address,
        clinicData.clinic.googleMapsUrl,
      ),
      {
        appointmentId: appt._id,
        patientId:     patient._id,
        messageType:   'PAYMENT_SUCCESS',
      }
    );

    console.log(`[PAYMENT] ✓ Confirmed appt ${appt.appointmentId} for ${patient.phone}`);

  } catch (err) {
    console.error('[PAYMENT WEBHOOK] Unhandled error:', err.message, err.stack);
  }
});

/**
 * GET /api/payment/pay/:orderId
 * The "Pay Now" button opens this page. It loads CashFree's JS SDK and launches
 * the hosted checkout using the order's payment_session_id.
 */
router.get('/pay/:orderId', async (req, res) => {
  const { orderId } = req.params;
  try {
    const { paymentSessionId, orderStatus } = await getOrder(orderId);

    if (orderStatus === 'PAID') {
      return res.send(page('Already paid', `<h2>✅ Payment complete</h2>
        <p>This appointment is already confirmed. You can close this window and return to WhatsApp.</p>`));
    }
    if (!paymentSessionId) {
      return res.status(409).send(page('Unavailable', `<h2>Link expired</h2>
        <p>This payment link is no longer active. Please reply <b>REBOOK</b> on WhatsApp to start again.</p>`));
    }

    const mode = IS_PROD ? 'production' : 'sandbox';
    return res.send(page('Redirecting to payment…', `<h2>Redirecting…</h2>
      <p>Taking you to secure checkout. Please wait.</p>
      <script src="https://sdk.cashfree.com/js/v3/cashfree.js"></script>
      <script>
        try {
          const cashfree = Cashfree({ mode: ${JSON.stringify(mode)} });
          cashfree.checkout({ paymentSessionId: ${JSON.stringify(paymentSessionId)}, redirectTarget: "_self" });
        } catch (e) {
          document.querySelector('.card').innerHTML =
            '<h2>Couldn\\'t open checkout</h2><p>Please reply REBOOK on WhatsApp to try again.</p>';
        }
      </script>`));
  } catch (err) {
    console.error('[PAYMENT] /pay render failed:', err.message);
    return res.status(502).send(page('Error', `<h2>Something went wrong</h2>
      <p>We couldn't open the payment page. Please reply <b>REBOOK</b> on WhatsApp to try again.</p>`));
  }
});

/**
 * GET /api/payment/return
 * Browser lands here after CashFree checkout. Verifies the order and shows a
 * friendly status page. (Booking confirmation itself happens via the webhook.)
 */
router.get('/return', async (req, res) => {
  const orderId = req.query.order_id;
  if (!orderId) {
    return res.status(400).send(page('Payment', `<h2>Payment</h2><p>Missing order reference.</p>`));
  }
  try {
    const result = await verifyOrder(orderId);
    if (result.paymentStatus === 'SUCCESS') {
      return res.send(page('Payment successful', `<h2>✅ Payment successful!</h2>
        <p>Your appointment is confirmed. Check WhatsApp for the details and directions.</p>
        <p>You can close this window.</p>`));
    }
    return res.send(page('Payment pending', `<h2>Payment ${result.paymentStatus.toLowerCase()}</h2>
      <p>If you completed the payment, confirmation will arrive on WhatsApp shortly.
      Otherwise reply <b>REBOOK</b> to try again.</p>`));
  } catch (err) {
    console.error('[PAYMENT] /return verify failed:', err.message);
    return res.send(page('Payment', `<h2>Thanks!</h2>
      <p>We're confirming your payment. Please check WhatsApp in a moment.</p>`));
  }
});

/**
 * GET /api/payment/status/:orderId
 * Manual status check — useful for testing and support.
 */
router.get('/status/:orderId', async (req, res) => {
  try {
    const result = await verifyOrder(req.params.orderId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
