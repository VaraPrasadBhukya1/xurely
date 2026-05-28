// src/utils/setupDb.js
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const connectDB   = require('../../config/database');
const { Clinic, Doctor } = require('../models');
const seed = require('../../config/clinicData');

(async () => {
  await connectDB();

  // Upsert clinic
  const clinic = await Clinic.findOneAndUpdate(
    { name: seed.clinic.name },
    seed.clinic,
    { upsert: true, new: true }
  );
  console.log(`✓ Clinic: ${clinic.name} (${clinic._id})`);

  // Upsert doctors
  for (const d of seed.doctors) {
    const doc = await Doctor.findOneAndUpdate(
      { name: d.name, clinicId: clinic._id },
      { ...d, clinicId: clinic._id },
      { upsert: true, new: true }
    );
    console.log(`✓ Doctor: ${doc.name}`);
  }

  console.log('\n✅ Database setup complete!');
  process.exit(0);
})().catch(err => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
