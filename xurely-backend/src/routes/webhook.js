// src/routes/webhook.js  — Whapi inbound webhook
const express = require('express');
const router  = express.Router();
const { handleInbound } = require('../services/botLogic');

/**
 * Whapi sends ALL events (messages, status updates, etc.) to one POST endpoint.
 * There is no GET verification step — Whapi just starts posting immediately.
 *
 * Whapi payload structure:
 * {
 *   event: { type: "messages", action: "pre-process" | ... },
 *   messages: [
 *     {
 *       id: "wamid.xxx",
 *       type: "text",
 *       from: "919876543210",      // sender phone (no +)
 *       text: { body: "Hi" },
 *       timestamp: 1234567890,
 *       ...
 *     }
 *   ]
 * }
 */
router.post('/', async (req, res) => {
  res.sendStatus(200); // always ack first

  try {
    const body     = req.body;
    const messages = body?.messages;

    if (!Array.isArray(messages) || messages.length === 0) return;

    for (const message of messages) {
      // Skip outbound messages
      if (message.from_me) continue;

      const phone = message.from;           // e.g. "919876543210"

      // Extract the user's input from whichever message shape Whapi sent.
      // - text:  plain message            → text.body
      // - reply: quick-reply button click → reply.buttons_reply.id
      //   Whapi prefixes button ids with "ButtonsV3:" (e.g. "ButtonsV3:doctor_0") — strip it.
      let text = null;
      if (message.type === 'text') {
        text = message.text?.body?.trim();
      } else if (message.type === 'reply') {
        const r = message.reply || {};
        text = (r.buttons_reply?.id || r.list_reply?.id || r.buttons_reply?.title)?.trim();
      } else if (message.type === 'interactive') {
        // some Whapi versions nest under `interactive`
        const i = message.interactive || {};
        text = (i.button_reply?.id || i.list_reply?.id)?.trim();
      } else {
        continue; // unsupported type (image, audio, etc.)
      }

      if (!phone || !text) continue;

      // Strip Whapi's button-id prefix ("ButtonsV3:doctor_0" → "doctor_0")
      text = text.replace(/^ButtonsV3:/, '');

      console.log(`[WEBHOOK] ← ${phone}: "${text}"`);

      // botLogic owns all routing now — including check-in triggers, which it
      // suppresses while the user is typing free text (name/question/enquiry).
      await handleInbound(phone, text);
    }

  } catch (err) {
    console.error('[WEBHOOK] Handler error:', err.message);
  }
});

module.exports = router;
