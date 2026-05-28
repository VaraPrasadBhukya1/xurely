// config/clinicData.js
module.exports = {
  clinic: {
    name: 'Dr. Vita Multispeciality Dental Clinic And Implant Centre',
    city: 'Hyderabad',
    address: '123 Dental Street, Banjara Hills, Hyderabad, Telangana 500034',
    phone: '080-4444-5555',
    email: 'hello@drvita.com',
    website: 'www.drvita.com',
    latitude: 17.3850,
    longitude: 78.4867,
    googleMapsUrl: process.env.CLINIC_GOOGLE_MAPS_URL || 'https://maps.google.com/?q=17.3850,78.4867',
  },
  doctors: [
    { name: 'Dr. Vita Sharma',  specialty: 'Dental Surgery',  qualification: 'BDS, MDS',               phone: '080-4444-5555' },
    { name: 'Dr. Priya Gupta',  specialty: 'Implantology',    qualification: 'BDS, Implant Specialist', phone: '080-4444-5556' },
    { name: 'Dr. Rohan Singh',  specialty: 'Orthodontics',    qualification: 'BDS, MDS',               phone: '080-4444-5557' },
  ],

  // ── FAQ knowledge base (used by the "Ask a Question" branch) ────────────────
  hours: {
    weekday: 'Mon–Sat: 9:00 AM – 8:00 PM',
    sunday:  'Sunday: 10:00 AM – 2:00 PM',
  },
  pricing: [
    'Consultation / Check-up — ₹500',
    'Teeth Cleaning (Scaling) — ₹1,500',
    'Dental Filling — ₹1,200 onwards',
    'Root Canal — ₹5,000 onwards',
    'Dental Implant — ₹25,000 onwards',
  ],
  treatments: [
    'General Dentistry & Check-ups',
    'Dental Implants & Implantology',
    'Orthodontics (Braces & Aligners)',
    'Root Canal Treatment',
    'Teeth Cleaning & Whitening',
    'Cosmetic Dentistry',
  ],
};
