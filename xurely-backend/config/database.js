// config/database.js
const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });
    console.log(`[DB] MongoDB Atlas connected: ${conn.connection.host}`);
  } catch (err) {
    console.error(`[DB] Connection failed: ${err.message}`);
    process.exit(1);
  }
};

mongoose.connection.on('disconnected', () =>
  console.warn('[DB] MongoDB disconnected — retrying...')
);
mongoose.connection.on('reconnected', () =>
  console.log('[DB] MongoDB reconnected')
);

module.exports = connectDB;
