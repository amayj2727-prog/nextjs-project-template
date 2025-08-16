const cron = require('node-cron');
const { getDB } = require('./db');
const { sendGSTReminder } = require('./email');

// GST due dates for different types of businesses
const GST_DUE_DATES = {
  monthly: [
    { day: 20, month: null, description: 'Monthly GST Return (GSTR-1)' },
    { day: 11, month: null, description: 'Monthly GST Return (GSTR-3B)' }
  ],
  quarterly: [
    { day: 18, month: [1, 4, 7, 10], description: 'Quarterly GST Return (GSTR-1)' },
    { day: 22, month: [1, 4, 7, 10], description: 'Quarterly GST Return (GSTR-3B)' }
  ],
  annual: [
    { day: 31, month: 12, description: 'Annual GST Return (GSTR-9)' }
  ]
};

/**
 * Check if a vendor needs GST reminder based on turnover
 * @param {string} turnoverRange - Vendor's turnover range
 * @returns {string} - GST filing frequency
 */
function getGSTFilingFrequency(turnoverRange) {
  switch (turnoverRange) {
    case '<10L':
      return 'quarterly'; // Composition scheme or small businesses
    case '10-40L':
      return 'quarterly';
    case '40L-1Cr':
      return 'monthly';
    case '>1Cr':
      return 'monthly';
    default:
      return 'monthly';
  }
}

/**
 * Check if today matches any GST due date
 * @param {Date} today - Current date
 * @param {string} frequency - Filing frequency
 * @returns {Array} - Array of matching due dates
 */
function getMatchingDueDates(today, frequency) {
  const currentDay = today.getDate();
  const currentMonth = today.getMonth() + 1; // JavaScript months are 0-indexed
  
  const dueDates = GST_DUE_DATES[frequency] || [];
  
  return dueDates.filter(dueDate => {
    if (dueDate.day !== currentDay) return false;
    
    if (dueDate.month === null) {
      // Monthly due dates (every month)
      return true;
    } else if (Array.isArray(dueDate.month)) {
      // Quarterly due dates (specific months)
      return dueDate.month.includes(currentMonth);
    } else {
      // Annual due dates (specific month)
      return dueDate.month === currentMonth;
    }
  });
}

/**
 * Send GST reminders to vendors
 */
async function sendGSTReminders() {
  try {
    console.log('🔔 Running GST reminder cron job...');
    
    const db = getDB();
    const today = new Date();
    
    // Get all vendors with their user information
    const vendors = await new Promise((resolve, reject) => {
      db.all(
        `SELECT v.*, u.name, u.email FROM Vendors v 
         JOIN Users u ON v.user_id = u.user_id 
         WHERE u.role = 'vendor'`,
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    let remindersSent = 0;

    for (const vendor of vendors) {
      const filingFrequency = getGSTFilingFrequency(vendor.turnover_range);
      const matchingDueDates = getMatchingDueDates(today, filingFrequency);
      
      if (matchingDueDates.length > 0) {
        try {
          // Send reminder for each matching due date
          for (const dueDate of matchingDueDates) {
            await sendGSTReminder({
              name: vendor.name,
              email: vendor.email,
              businessName: vendor.business_name,
              businessType: vendor.business_type,
              gstNumber: vendor.gst_number
            }, dueDate.description);

            // Log the reminder in notifications table
            await new Promise((resolve, reject) => {
              db.run(
                `INSERT INTO Notifications (user_id, title, message, type, channel) 
                 VALUES (?, ?, ?, ?, ?)`,
                [
                  vendor.user_id,
                  'GST Filing Reminder',
                  `Reminder: ${dueDate.description} is due today`,
                  'warning',
                  'email'
                ],
                (err) => {
                  if (err) reject(err);
                  else resolve();
                }
              );
            });

            remindersSent++;
          }
        } catch (emailError) {
          console.error(`Failed to send GST reminder to ${vendor.email}:`, emailError);
        }
      }
    }

    console.log(`✅ GST reminder cron job completed. Sent ${remindersSent} reminders.`);
    
  } catch (error) {
    console.error('❌ GST reminder cron job failed:', error);
  }
}

/**
 * Send compliance status reminders
 */
async function sendComplianceReminders() {
  try {
    console.log('🔔 Running compliance reminder cron job...');
    
    const db = getDB();
    
    // Get vendors with pending compliance status
    const pendingVendors = await new Promise((resolve, reject) => {
      db.all(
        `SELECT v.*, u.name, u.email FROM Vendors v 
         JOIN Users u ON v.user_id = u.user_id 
         WHERE v.compliance_status = 'pending' AND u.role = 'vendor'`,
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    let remindersSent = 0;

    for (const vendor of pendingVendors) {
      try {
        // Create in-app notification
        await new Promise((resolve, reject) => {
          db.run(
            `INSERT INTO Notifications (user_id, title, message, type) 
             VALUES (?, ?, ?, ?)`,
            [
              vendor.user_id,
              'Compliance Status Pending',
              'Please complete your compliance requirements. Contact your assigned CA for assistance.',
              'warning'
            ],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });

        remindersSent++;
      } catch (error) {
        console.error(`Failed to send compliance reminder to ${vendor.email}:`, error);
      }
    }

    console.log(`✅ Compliance reminder cron job completed. Sent ${remindersSent} reminders.`);
    
  } catch (error) {
    console.error('❌ Compliance reminder cron job failed:', error);
  }
}

/**
 * Clean up old activity logs (keep only last 90 days)
 */
async function cleanupOldLogs() {
  try {
    console.log('🧹 Running log cleanup cron job...');
    
    const db = getDB();
    
    // Delete logs older than 90 days
    const result = await new Promise((resolve, reject) => {
      db.run(
        `DELETE FROM ActivityLogs 
         WHERE timestamp < datetime('now', '-90 days')`,
        function(err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });

    console.log(`✅ Log cleanup completed. Deleted ${result} old log entries.`);
    
  } catch (error) {
    console.error('❌ Log cleanup cron job failed:', error);
  }
}

/**
 * Initialize all cron jobs
 */
function initializeCronJobs() {
  console.log('⏰ Initializing cron jobs...');

  // GST reminders - Run daily at 8:00 AM
  cron.schedule('0 8 * * *', () => {
    sendGSTReminders();
  }, {
    scheduled: true,
    timezone: "Asia/Kolkata"
  });

  // Compliance reminders - Run weekly on Monday at 9:00 AM
  cron.schedule('0 9 * * 1', () => {
    sendComplianceReminders();
  }, {
    scheduled: true,
    timezone: "Asia/Kolkata"
  });

  // Log cleanup - Run monthly on the 1st at 2:00 AM
  cron.schedule('0 2 1 * *', () => {
    cleanupOldLogs();
  }, {
    scheduled: true,
    timezone: "Asia/Kolkata"
  });

  // Test reminder - Run every minute (for testing purposes - remove in production)
  if (process.env.NODE_ENV === 'development') {
    cron.schedule('*/5 * * * *', () => {
      console.log('🔔 Test cron job running every 5 minutes...');
    }, {
      scheduled: true,
      timezone: "Asia/Kolkata"
    });
  }

  console.log('✅ Cron jobs initialized successfully');
  console.log('📅 Scheduled jobs:');
  console.log('   - GST reminders: Daily at 8:00 AM IST');
  console.log('   - Compliance reminders: Weekly on Monday at 9:00 AM IST');
  console.log('   - Log cleanup: Monthly on 1st at 2:00 AM IST');
  
  if (process.env.NODE_ENV === 'development') {
    console.log('   - Test job: Every 5 minutes (development only)');
  }
}

/**
 * Manual trigger functions for testing
 */
function triggerGSTReminders() {
  console.log('🔔 Manually triggering GST reminders...');
  return sendGSTReminders();
}

function triggerComplianceReminders() {
  console.log('🔔 Manually triggering compliance reminders...');
  return sendComplianceReminders();
}

function triggerLogCleanup() {
  console.log('🧹 Manually triggering log cleanup...');
  return cleanupOldLogs();
}

module.exports = {
  initializeCronJobs,
  triggerGSTReminders,
  triggerComplianceReminders,
  triggerLogCleanup,
  sendGSTReminders,
  sendComplianceReminders,
  cleanupOldLogs
};
