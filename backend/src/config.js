require('dotenv').config();
const path = require('path');

const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),
  mongoUri: process.env.MONGODB_URI || 'memory',
  jwtSecret: process.env.JWT_SECRET || 'insecure-dev-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  webDist: process.env.WEB_DIST || path.join(__dirname, '..', '..', 'frontend', 'dist'),
};

function assertConfig() {
  if (config.env === 'production' && (config.jwtSecret === 'insecure-dev-secret' || !process.env.MONGODB_URI)) {
    throw new Error('JWT_SECRET and MONGODB_URI must be set in production');
  }
}

module.exports = { config, assertConfig };
