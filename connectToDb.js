/**
 * @file connectToDb.js
 * @description MongoDB connection manager using Mongoose.
 */

const mongoose = require('mongoose');

/**
 * Establishes a persistent connection to the MongoDB cluster.
 * @returns {Promise<mongoose.Connection>}
 */
const connectToDb = async () => {
  try {
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/deployx';
    
    // Connect with autoIndex and reasonable timeouts
    await mongoose.connect(mongoUri, {
      dbName: process.env.MONGO_DB_NAME || 'test',
      serverSelectionTimeoutMS: 5000,
    });
    
    console.log('[Database] Successfully connected to MongoDB');
  } catch (err) {
    console.error('[Database] MongoDB connection error:', err.message);
  }
};

module.exports = { connectToDb };