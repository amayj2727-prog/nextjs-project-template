const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const vendorRoutes = require('./routes/vendor');
const caRoutes = require('./routes/ca');
const adminRoutes = require('./routes/admin');
const { initDB } = require('./utils/db');
const { initializeCronJobs } = require('./utils/cron');

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/auth', authRoutes);
app.use('/vendor', vendorRoutes);
app.use('/ca', caRoutes);
app.use('/admin', adminRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'NammaCompliance API is running',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// System info endpoint
app.get('/info', (req, res) => {
  res.json({
    name: 'NammaCompliance API',
    version: '1.0.0',
    description: 'GST compliance and licensing management system for Karnataka vendors',
    environment: process.env.NODE_ENV || 'development',
    features: {
      authentication: true,
      fileUploads: true,
      emailNotifications: process.env.ENABLE_EMAIL_NOTIFICATIONS === 'true',
      cronJobs: process.env.ENABLE_CRON_JOBS === 'true',
      whatsappNotifications: process.env.ENABLE_WHATSAPP_NOTIFICATIONS === 'true'
    }
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({ 
    error: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Graceful shutdown handler
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully...');
  process.exit(0);
});

// Initialize database and start server
initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 NammaCompliance API server running on port ${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/health`);
      console.log(`ℹ️  System info: http://localhost:${PORT}/info`);
      
      // Initialize cron jobs if enabled
      if (process.env.ENABLE_CRON_JOBS !== 'false') {
        initializeCronJobs();
      } else {
        console.log('⏰ Cron jobs disabled');
      }
    });
  })
  .catch((dbErr) => {
    console.error('❌ Database initialization failed:', dbErr);
    process.exit(1);
  });

module.exports = app;
