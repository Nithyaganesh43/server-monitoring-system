const mongoose = require('mongoose');

const connectToDb = async () => {
  const maxRetries = 3;
  let retries = 0;

  while (retries < maxRetries) {
    try {
      await mongoose.connect(process.env.MONGO_URL+'PRODUCTION', { 
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 10000
      });

      console.log('Connected to MongoDB');
      return;
    } catch (error) {
      retries++;
      console.error(`Database connection attempt ${retries}/${maxRetries} failed:`, error.message);

      if (retries === maxRetries) {
        throw error;
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
};

module.exports = { connectToDb };