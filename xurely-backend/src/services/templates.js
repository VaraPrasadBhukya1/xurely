// src/services/templates.js

const T = {
  // ── ONBOARDING (Stage 1–3) ───────────────────────────────────────────────
  greeting: (clinicName, name) => name
    ? `Hi *${name}*! 👋 Welcome back to *${clinicName}*.

I'm Xurely — your AI appointment assistant.

What can I help you with today?`
    : `Hi! Welcome to *${clinicName}* 👋

I'm Xurely — your AI appointment assistant.

What can I help you with today?`,

  namePrompt: () => `Thanks for reaching out! 😊

To get started, what's your name?`,

  invalidName: () => `That doesn't look quite like a name. 😊

Could you please share your name?

Example: *Priya* or *Rajesh Kumar*`,

  bookingDoctorPrompt: (name) => `Great, ${name}! 🎉

Let me help you book an appointment.

Which doctor would you like to see?`,

  askPrompt: (name) => `Thanks for reaching out, ${name}! 💬

What would you like to know? Just type your question.`,

  generalPrompt: (name) => `Thanks for your interest, ${name}! 😊

Tell me more about what you're looking for.`,

  // ── FAQ ANSWERS (Ask a Question branch) ───────────────────────────────────
  faqHours: (clinicName, weekday, sunday) => `🕐 *Our Clinic Hours*

${clinicName}

${weekday}
${sunday}

Would you like to book an appointment?`,

  faqPricing: (lines) => `💰 *Our Pricing* (indicative)

${lines.map(l => `• ${l}`).join('\n')}

Final cost depends on your consultation. Want to book a check-up?`,

  faqTreatments: (lines) => `🦷 *Treatments We Offer*

${lines.map(l => `• ${l}`).join('\n')}

Would you like to book an appointment?`,

  clinicAddress: (clinicName, address, mapsUrl) => `📍 *${clinicName}*

${address}

🗺️ Directions:
${mapsUrl}`,

  // ── GENERAL ENQUIRY / SUPPORT ──────────────────────────────────────────────
  symptomBookingNudge: (name) => `I understand, ${name}. 🦷

That sounds like something our dentists should take a look at — booking an appointment will help.

Let's get you scheduled.`,

  generalAck: (name) => `Thanks, ${name}! I've noted that down. 📝`,

  supportHandoff: () => `I want to make sure I help you properly. 🤝

Let me connect you with our team — they'll get back to you shortly.

Meanwhile, you can type *menu* to start over or *book* to make an appointment.`,

  // ── INACTIVITY TIMEOUTS ────────────────────────────────────────────────────
  inactivityNudge: (name) => `Still there${name && name !== 'there' ? `, ${name}` : ''}? 😊

Just reply to continue where we left off, or type *menu* to start over.`,

  inactivityPaused: (phone) => `No rush — I'll keep your chat open. Message me anytime! 💚

📞 Prefer to call? ${phone}`,

  availableSlots: (doctorName) => `Hi there! 👋

Great! I found ${doctorName} for you.

Here's what I see available:

🕐 10:00 AM — Tomorrow
🕐 2:30 PM — Tomorrow
🕐 9:00 AM — Day after tomorrow

Which time works best for you? Just reply with the time! ⏰`,

  // Single, compact slot-reserved + pay prompt (sent with the "Pay Now" button).
  payPrompt: (doctorName, timeSlot, dateLabel) => `✅ *${timeSlot}${dateLabel ? `, ${dateLabel}` : ''}* with ${doctorName} is reserved!

Tap below to pay *₹999* (20% off) and confirm. Your slot is held until payment. 💚`,

  // Fallback when no payment link could be created.
  payPromptNoLink: (doctorName, timeSlot, phone) => `✅ *${timeSlot}* with ${doctorName} is reserved!

To confirm, please call us at ${phone} to complete the ₹999 payment. 💚`,

  paymentSuccess: (doctorName, timeSlot, date, clinicName, address, mapsUrl) => `🎉 You're all set!

Your appointment is confirmed!

👨‍⚕️ ${doctorName}
📍 ${clinicName}
    ${address}
🗓️  ${date}
🕐 ${timeSlot}

📍 Get Directions:
${mapsUrl}

What's next?
✓ We'll remind you 24 hours before
✓ Check in via WhatsApp when you arrive
✓ We'll take great care of you

See you soon! 💚`,

  reminder24h: (doctorName, timeSlot, mapsUrl) => `⏰ See you tomorrow!

Quick reminder: Your appointment with ${doctorName} is tomorrow at ${timeSlot}.

📋 A few tips:
• Arrive 5 minutes early
• Bring any previous dental records
• Wear comfortable clothing

📍 Directions:
${mapsUrl}

Any questions? Just reply! 😊 💚`,

  reminder2h: (doctorName, queuePos, waitTime, mapsUrl) => `🔔 Almost time!

2 hours until your appointment with ${doctorName}!

📍 Queue position: #${queuePos}
⏱️  Estimated wait: ${waitTime} minutes

📍 Directions (if needed):
${mapsUrl}

Already on your way? Perfect!
Can't make it? Reply LATE and we'll reschedule. 💚`,

  checkInRequest: (clinicName) => `Welcome to ${clinicName}! 🎉

To confirm your arrival, please reply with your registered phone number (10 digits):
Example: 9876543210`,

  otpSent: (otp) => `Your check-in code: *${otp.split('').join(' ')}*

✓ Valid for 10 minutes
✓ Reply with this 4-digit code

Do NOT share this code with anyone.`,

  otpWrong: (attemptsRemaining) => `❌ Incorrect code.

${attemptsRemaining} attempt(s) remaining.

Please re-enter the 4-digit code.`,

  otpExpired: () => `⏰ Code Expired

Your code has expired. Let's send a new one.

Please reply with your registered phone number again:
Example: 9876543210`,

  attendanceConfirmed: (queuePos, waitTime) => `✅ Checked in!

You're confirmed!

👤 Your queue position: #${queuePos}
⏱️  Estimated wait: ${waitTime} minutes

Have a seat — we'll call you soon! 💚`,

  reviewRequest: (doctorName) => `Thank you for visiting us! 💚

How was your experience with ${doctorName} today?

⭐⭐⭐⭐⭐ Excellent!
⭐⭐⭐⭐ Good
⭐⭐⭐ Okay
⭐⭐ Could be better
⭐ Not satisfied

Just reply with the number of stars (1–5)!`,

  reviewThankYouHigh: (googleUrl) => `🎉 Thank you so much!

We're thrilled you had a great experience!

Quick favor — could you share it on Google? It helps other patients find us!

${googleUrl}

Thanks for trusting us! ✨ 💚`,

  reviewThankYouLow: (phone) => `Thank you for being honest. 💚

We're sorry your experience didn't meet expectations. We'd love to hear more so we can improve.

📞 Call us: ${phone}

Your feedback truly matters to us. 😊`,

  noShow: (doctorName) => `We missed you today 😞

Dr. ${doctorName} was waiting for your appointment.

No worries — let's reschedule:
👉 Reply REBOOK for a new slot

You won't be charged for today. 💚 See you next time!`,

  paymentReminder2h: (timeSlot, link) => `Hey! 👋

Your ${timeSlot} slot is still on hold — it just needs payment to be confirmed.

Still interested? 💚

₹999 | ${link}

Or reply CANCEL if you'd like a different time.`,

  paymentReminder6h: (timeSlot, link) => `⚡ Last chance!

Your ${timeSlot} slot expires in 2 hours — someone else may take it.

💳 ${link}`,
};

module.exports = T;
