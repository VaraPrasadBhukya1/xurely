# Dr. Vita WhatsApp Bot — Deployment Guide

## Project Structure
```
drvita-backend/
├── config/
│   ├── database.js        # MongoDB Atlas connection
│   └── clinicData.js      # Clinic + doctors seed data
├── src/
│   ├── models/index.js    # All Mongoose models
│   ├── services/
│   │   ├── botLogic.js    # Conversation flow (state machine)
│   │   ├── whatsapp.js    # WhatsApp Cloud API calls
│   │   ├── payment.js     # CashFree integration
│   │   ├── otp.js         # OTP generation & verification
│   │   ├── reminders.js   # Cron-based reminder scheduler
│   │   └── templates.js   # All WhatsApp message templates
│   ├── routes/
│   │   ├── webhook.js     # WhatsApp inbound webhook
│   │   ├── payment.js     # CashFree payment webhook
│   │   └── admin.js       # Admin API
│   ├── utils/setupDb.js   # DB seed script
│   └── server.js          # Express entry point
├── .env.example
└── package.json
```

---

## Step 1 — MongoDB Atlas Setup

1. Go to [mongodb.com/atlas](https://www.mongodb.com/atlas) → create free cluster
2. Create a database user (username + password)
3. Whitelist IP: **0.0.0.0/0** (allows Hostinger to connect)
4. Get connection string:
   ```
   mongodb+srv://<user>:<password>@<cluster>.mongodb.net/drvita?retryWrites=true&w=majority
   ```

---

## Step 2 — Hostinger VPS Setup

SSH into your VPS and run:

```bash
# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 (process manager)
sudo npm install -g pm2

# Clone or upload your project
cd /var/www
git clone <your-repo> drvita-backend
# OR: upload via Hostinger File Manager / SFTP

cd drvita-backend
npm install --production
```

---

## Step 3 — Environment Variables

```bash
cp .env.example .env
nano .env
```

Fill in all values:
- `MONGODB_URI` — from Step 1
- `WHATSAPP_PHONE_NUMBER_ID` — from Meta Developer Console
- `WHATSAPP_ACCESS_TOKEN` — permanent token from Meta
- `WHATSAPP_VERIFY_TOKEN` — any secret string you choose (match in Meta webhook settings)
- `CASHFREE_APP_ID` / `CASHFREE_SECRET_KEY` — from CashFree dashboard
- `CASHFREE_RETURN_URL` — `https://yourdomain.com/api/payment/webhook`
- `ADMIN_API_KEY` — any secret string for admin routes

---

## Step 4 — Seed the Database

```bash
node src/utils/setupDb.js
```

This inserts the clinic and 3 doctors into MongoDB Atlas.

---

## Step 5 — Start with PM2

```bash
pm2 start src/server.js --name drvita-bot
pm2 save
pm2 startup   # auto-start on reboot
```

Check logs:
```bash
pm2 logs drvita-bot
```

---

## Step 6 — Nginx Reverse Proxy (Hostinger)

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable HTTPS with Let's Encrypt:
```bash
sudo certbot --nginx -d yourdomain.com
```

---

## Step 7 — Whapi Webhook Configuration

In your [Whapi Dashboard](https://app.whapi.cloud):

1. Go to your Channel → **Settings** → **Webhooks**
2. Set webhook URL: `https://yourdomain.com/webhook`
3. Enable event: **Messages**
4. Save — Whapi will start posting inbound messages immediately (no verify step)

Your two `.env` values come from the same page:
- `WHAPI_URL` → the channel API URL shown at the top (e.g. `https://gate.whapi.cloud/channels/ABC123`)
- `WHAPI_TOKEN` → the **Token** field on the channel page

---

## Step 8 — CashFree Webhook

In CashFree Dashboard → Webhooks:
- URL: `https://yourdomain.com/api/payment/webhook`
- Events: `PAYMENT_SUCCESS`, `PAYMENT_FAILED`

---

## Patient Flow

```
Patient says "Hi"
  → Bot looks up phone in DB (returning patient? greet by name)
  → Bot shows enquiry menu: [Book Appointment] [Ask a Question] [General Enquiry]

  ── NEW patient → Bot asks for name (validated) and saves it.
     RETURNING patients skip this step entirely.

  Branch A — Book Appointment:
     → doctor list → pick doctor → time slots → pick slot
     → Bot creates appointment + sends CashFree payment link
     → Patient pays → CashFree hits /api/payment/webhook
     → Bot sends confirmation with Google Maps link

  Branch B — Ask a Question:
     → Bot answers FAQ by keyword (hours / pricing / treatments / address)
     → Can't answer → opens a SUPPORT TICKET for an agent

  Branch C — General Enquiry:
     → Symptom words → suggests booking and starts the booking flow
     → Address/location words → sends clinic address + maps
     → Otherwise → opens a SUPPORT TICKET for an agent

Idle mid-flow: gentle nudge after 5 min, "chat kept open" after 25 min.

[24h before]  Bot sends reminder
[2h before]   Bot sends reminder with queue position

Patient arrives → says "I'm here"
  → Bot asks for phone number
  → Bot sends OTP
  → Patient enters OTP → attendance confirmed

[30min after]  Bot sends review request (1–5 stars)
  → 4–5 stars → routed to Google Reviews
  → 1–3 stars → private feedback
```

---

## Admin API

All endpoints require header: `x-admin-key: YOUR_KEY`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/appointments` | List appointments |
| POST | `/api/admin/appointments/:id/complete` | Mark complete + send review |
| POST | `/api/admin/send-message` | Send manual WhatsApp message |
| GET | `/api/admin/support-tickets` | Handoff queue (`?status=OPEN\|IN_PROGRESS\|CLOSED\|ALL`) |
| POST | `/api/admin/support-tickets/:id/status` | Update ticket status |
| GET | `/api/admin/stats` | Dashboard stats |

---

## Health Check

```
GET /health → { "status": "ok", "ts": "..." }
```
