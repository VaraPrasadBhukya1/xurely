// src/services/payment.js
'use strict';

const axios = require('axios');
const { Payment } = require('../models');

// ── ENVIRONMENT ────────────────────────────────────────────────────────────────
// Set CASHFREE_ENV=PROD in .env when going live — sandbox by default
const IS_PROD  = process.env.CASHFREE_ENV === 'PROD';
const BASE_URL = IS_PROD
  ? 'https://api.cashfree.com/pg'
  : 'https://sandbox.cashfree.com/pg';

// Build headers lazily so env vars are always fresh at call time
function cfHeaders() {
  return {
    'Content-Type':   'application/json',
    'x-api-version':  '2023-08-01',
    'x-client-id':    process.env.CASHFREE_APP_ID,
    'x-client-secret': process.env.CASHFREE_SECRET_KEY,
  };
}

// Public origin of THIS server, used to build the hosted "Pay Now" checkout link.
// Falls back to the origin of CASHFREE_RETURN_URL (already a public URL to this server).
function originOf(url) {
  try { return new URL(url).origin; } catch { return null; }
}
const PUBLIC_BASE = (process.env.PUBLIC_BASE_URL || originOf(process.env.CASHFREE_RETURN_URL) || '').replace(/\/$/, '');

const AMOUNT_ORIGINAL  = parseFloat(process.env.PAYMENT_AMOUNT           || 1249);
const DISCOUNT_PERCENT = parseFloat(process.env.PAYMENT_DISCOUNT_PERCENT || 20);
const DISCOUNT_AMOUNT  = parseFloat((AMOUNT_ORIGINAL * DISCOUNT_PERCENT / 100).toFixed(2));
const AMOUNT_FINAL     = parseFloat((AMOUNT_ORIGINAL - DISCOUNT_AMOUNT).toFixed(2));

/**
 * Create a CashFree order and return the payment session link.
 */
async function createOrder(appointmentId, patientId, customerName, customerPhone, customerEmail) {
  const orderId = `ORD_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

  const body = {
    order_id:       orderId,
    order_amount:   AMOUNT_FINAL,
    order_currency: 'INR',
    order_note:     `Xurely Appointment ${appointmentId}`,
    customer_details: {
      customer_id:    patientId.toString().slice(-20), // CashFree max 50 chars
      customer_name:  customerName.slice(0, 100),
      customer_phone: String(customerPhone).replace(/\D/g, '').slice(-10),
      customer_email: customerEmail || 'patient@xurely.com',
    },
    order_meta: {
      // return_url = where the browser lands after payment (GET, friendly page).
      // notify_url = server-to-server webhook (POST) that confirms the booking.
      return_url: `${PUBLIC_BASE}/api/payment/return?order_id={order_id}`,
      notify_url: process.env.CASHFREE_RETURN_URL,
    },
  };

  let cfResponse;
  try {
    const { data } = await axios.post(`${BASE_URL}/orders`, body, { headers: cfHeaders() });
    cfResponse = data;
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error('[PAYMENT] CashFree order creation failed:', JSON.stringify(detail));
    throw new Error(`CashFree error: ${JSON.stringify(detail)}`);
  }

  // The Orders API (v2023-08-01) returns a payment_session_id, not a hosted URL.
  // We hand that session to CashFree's JS SDK from our own /api/payment/pay/:orderId
  // page, so "Pay Now" opens a real working checkout instead of a dead link.
  const paymentLink =
    cfResponse.payment_link ||
    (PUBLIC_BASE && cfResponse.payment_session_id
      ? `${PUBLIC_BASE}/api/payment/pay/${orderId}`
      : null);

  if (!paymentLink) {
    console.warn('[PAYMENT] Could not build a payment link — set PUBLIC_BASE_URL or CASHFREE_RETURN_URL.');
  }

  await Payment.create({
    appointmentId,
    patientId,
    amountOriginal:  AMOUNT_ORIGINAL,
    discountPercent: DISCOUNT_PERCENT,
    discountAmount:  DISCOUNT_AMOUNT,
    amountFinal:     AMOUNT_FINAL,
    paymentGateway:  'CASHFREE',
    cashfreeOrderId: orderId,
    paymentStatus:   'PENDING',
  });

  console.log(`[PAYMENT] ✓ Order created: ${orderId} | ₹${AMOUNT_FINAL} | env=${IS_PROD ? 'PROD' : 'SANDBOX'}`);

  return {
    orderId,
    paymentLink,
    paymentSessionId: cfResponse.payment_session_id || null,
    amountFinal:      AMOUNT_FINAL,
    amountOriginal:   AMOUNT_ORIGINAL,
    discount:         DISCOUNT_AMOUNT,
  };
}

/**
 * Verify a CashFree order status — always re-fetch from CashFree, never trust webhook body alone.
 * Returns { orderId, cfStatus, paymentStatus, alreadyProcessed }
 */
async function verifyOrder(orderId) {
  let data;
  try {
    const res = await axios.get(`${BASE_URL}/orders/${orderId}`, { headers: cfHeaders() });
    data = res.data;
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error('[PAYMENT] verifyOrder failed:', JSON.stringify(detail));
    throw new Error(`CashFree verify error: ${JSON.stringify(detail)}`);
  }

  const cfStatus = data.order_status; // PAID | ACTIVE | EXPIRED | CANCELLED
  const statusMap = { PAID: 'SUCCESS', ACTIVE: 'PENDING', EXPIRED: 'FAILED', CANCELLED: 'CANCELLED' };
  const paymentStatus = statusMap[cfStatus] || 'PENDING';

  // Idempotency: check if already marked SUCCESS before updating
  const existing = await Payment.findOne({ cashfreeOrderId: orderId }).lean();
  const alreadyProcessed = existing?.paymentStatus === 'SUCCESS';

  if (!alreadyProcessed) {
    await Payment.findOneAndUpdate(
      { cashfreeOrderId: orderId },
      {
        paymentStatus,
        cashfreePaymentId: data.cf_order_id?.toString() || null,
        paidAt: paymentStatus === 'SUCCESS' ? new Date() : null,
      }
    );
  }

  return { orderId, cfStatus, paymentStatus, alreadyProcessed };
}

/**
 * Fetch an order's current payment session + status from CashFree.
 * Used by the hosted checkout page to open the SDK with a fresh session id.
 */
async function getOrder(orderId) {
  const { data } = await axios.get(`${BASE_URL}/orders/${orderId}`, { headers: cfHeaders() });
  return {
    orderStatus:      data.order_status || null,        // PAID | ACTIVE | EXPIRED | ...
    paymentSessionId: data.payment_session_id || null,
    orderAmount:      data.order_amount ?? null,
  };
}

module.exports = { createOrder, verifyOrder, getOrder, IS_PROD, AMOUNT_FINAL, AMOUNT_ORIGINAL, DISCOUNT_AMOUNT };
