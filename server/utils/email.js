const nodemailer = require('nodemailer');

// Create transporter using Gmail SMTP
const transporter = nodemailer.createTransporter({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER || 'your-email@gmail.com',
    pass: process.env.GMAIL_PASS || 'your-app-password'
  }
});

// Verify transporter configuration
transporter.verify((error, success) => {
  if (error) {
    console.log('❌ Email transporter verification failed:', error);
  } else {
    console.log('✅ Email server is ready to send messages');
  }
});

/**
 * Send email notification
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.text - Plain text content
 * @param {string} options.html - HTML content (optional)
 * @returns {Promise} - Promise resolving to email info
 */
function sendEmail({ to, subject, text, html }) {
  const mailOptions = {
    from: process.env.GMAIL_USER || 'nammacompliance@gmail.com',
    to,
    subject,
    text,
    html: html || `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px;">
          <h2 style="color: #333; margin-bottom: 20px;">NammaCompliance</h2>
          <div style="background-color: white; padding: 20px; border-radius: 4px; border-left: 4px solid #007bff;">
            <p style="color: #555; line-height: 1.6; margin: 0;">${text}</p>
          </div>
          <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee; color: #888; font-size: 12px;">
            <p>This is an automated message from NammaCompliance. Please do not reply to this email.</p>
          </div>
        </div>
      </div>
    `
  };

  return transporter.sendMail(mailOptions)
    .then((info) => {
      console.log('📧 Email sent successfully:', info.messageId);
      return info;
    })
    .catch((error) => {
      console.error('❌ Email sending failed:', error);
      throw error;
    });
}

/**
 * Send GST reminder email
 * @param {Object} vendor - Vendor information
 * @param {string} dueDate - GST due date
 */
function sendGSTReminder(vendor, dueDate) {
  const subject = 'GST Return Filing Reminder - NammaCompliance';
  const text = `
Dear ${vendor.name},

This is a friendly reminder that your GST return filing is due on ${dueDate}.

Business Details:
- Business Name: ${vendor.businessName}
- GST Number: ${vendor.gstNumber || 'Not provided'}
- Business Type: ${vendor.businessType}

Please ensure you file your GST return on time to avoid penalties.

If you need assistance, please contact your assigned CA or open a case in the NammaCompliance portal.

Best regards,
NammaCompliance Team
  `;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px;">
        <h2 style="color: #333; margin-bottom: 20px;">🏛️ NammaCompliance</h2>
        <div style="background-color: white; padding: 20px; border-radius: 4px; border-left: 4px solid #ffc107;">
          <h3 style="color: #856404; margin-top: 0;">GST Return Filing Reminder</h3>
          <p style="color: #555; line-height: 1.6;">Dear <strong>${vendor.name}</strong>,</p>
          <p style="color: #555; line-height: 1.6;">This is a friendly reminder that your GST return filing is due on <strong>${dueDate}</strong>.</p>
          
          <div style="background-color: #f8f9fa; padding: 15px; border-radius: 4px; margin: 20px 0;">
            <h4 style="color: #333; margin-top: 0;">Business Details:</h4>
            <ul style="color: #555; margin: 0; padding-left: 20px;">
              <li><strong>Business Name:</strong> ${vendor.businessName}</li>
              <li><strong>GST Number:</strong> ${vendor.gstNumber || 'Not provided'}</li>
              <li><strong>Business Type:</strong> ${vendor.businessType}</li>
            </ul>
          </div>
          
          <p style="color: #555; line-height: 1.6;">Please ensure you file your GST return on time to avoid penalties.</p>
          <p style="color: #555; line-height: 1.6;">If you need assistance, please contact your assigned CA or open a case in the NammaCompliance portal.</p>
          
          <div style="margin-top: 20px;">
            <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard" 
               style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block;">
              Open NammaCompliance Portal
            </a>
          </div>
        </div>
        <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee; color: #888; font-size: 12px;">
          <p>This is an automated reminder from NammaCompliance. Please do not reply to this email.</p>
        </div>
      </div>
    </div>
  `;

  return sendEmail({
    to: vendor.email,
    subject,
    text,
    html
  });
}

/**
 * Send case update notification
 * @param {Object} vendor - Vendor information
 * @param {Object} caseInfo - Case information
 * @param {string} update - Update message
 */
function sendCaseUpdateNotification(vendor, caseInfo, update) {
  const subject = `Case Update: ${caseInfo.title} - NammaCompliance`;
  const text = `
Dear ${vendor.name},

Your case "${caseInfo.title}" has been updated.

Case Details:
- Case ID: #${caseInfo.id}
- Status: ${caseInfo.status}
- Priority: ${caseInfo.priority}

Update: ${update}

You can view the full case details in your NammaCompliance dashboard.

Best regards,
NammaCompliance Team
  `;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px;">
        <h2 style="color: #333; margin-bottom: 20px;">🏛️ NammaCompliance</h2>
        <div style="background-color: white; padding: 20px; border-radius: 4px; border-left: 4px solid #28a745;">
          <h3 style="color: #155724; margin-top: 0;">Case Update Notification</h3>
          <p style="color: #555; line-height: 1.6;">Dear <strong>${vendor.name}</strong>,</p>
          <p style="color: #555; line-height: 1.6;">Your case "<strong>${caseInfo.title}</strong>" has been updated.</p>
          
          <div style="background-color: #f8f9fa; padding: 15px; border-radius: 4px; margin: 20px 0;">
            <h4 style="color: #333; margin-top: 0;">Case Details:</h4>
            <ul style="color: #555; margin: 0; padding-left: 20px;">
              <li><strong>Case ID:</strong> #${caseInfo.id}</li>
              <li><strong>Status:</strong> ${caseInfo.status}</li>
              <li><strong>Priority:</strong> ${caseInfo.priority}</li>
            </ul>
          </div>
          
          <div style="background-color: #e7f3ff; padding: 15px; border-radius: 4px; margin: 20px 0; border-left: 4px solid #007bff;">
            <h4 style="color: #004085; margin-top: 0;">Update:</h4>
            <p style="color: #004085; margin: 0;">${update}</p>
          </div>
          
          <p style="color: #555; line-height: 1.6;">You can view the full case details in your NammaCompliance dashboard.</p>
          
          <div style="margin-top: 20px;">
            <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard" 
               style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block;">
              View Case Details
            </a>
          </div>
        </div>
        <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee; color: #888; font-size: 12px;">
          <p>This is an automated notification from NammaCompliance. Please do not reply to this email.</p>
        </div>
      </div>
    </div>
  `;

  return sendEmail({
    to: vendor.email,
    subject,
    text,
    html
  });
}

/**
 * Send welcome email to new users
 * @param {Object} user - User information
 */
function sendWelcomeEmail(user) {
  const subject = 'Welcome to NammaCompliance!';
  const text = `
Dear ${user.name},

Welcome to NammaCompliance! Your account has been successfully created.

Account Details:
- Name: ${user.name}
- Email: ${user.email}
- Role: ${user.role}

You can now log in to your dashboard and start managing your GST compliance and licensing requirements.

If you have any questions, please don't hesitate to contact our support team.

Best regards,
NammaCompliance Team
  `;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px;">
        <h2 style="color: #333; margin-bottom: 20px;">🏛️ NammaCompliance</h2>
        <div style="background-color: white; padding: 20px; border-radius: 4px; border-left: 4px solid #28a745;">
          <h3 style="color: #155724; margin-top: 0;">Welcome to NammaCompliance!</h3>
          <p style="color: #555; line-height: 1.6;">Dear <strong>${user.name}</strong>,</p>
          <p style="color: #555; line-height: 1.6;">Welcome to NammaCompliance! Your account has been successfully created.</p>
          
          <div style="background-color: #f8f9fa; padding: 15px; border-radius: 4px; margin: 20px 0;">
            <h4 style="color: #333; margin-top: 0;">Account Details:</h4>
            <ul style="color: #555; margin: 0; padding-left: 20px;">
              <li><strong>Name:</strong> ${user.name}</li>
              <li><strong>Email:</strong> ${user.email}</li>
              <li><strong>Role:</strong> ${user.role}</li>
            </ul>
          </div>
          
          <p style="color: #555; line-height: 1.6;">You can now log in to your dashboard and start managing your GST compliance and licensing requirements.</p>
          <p style="color: #555; line-height: 1.6;">If you have any questions, please don't hesitate to contact our support team.</p>
          
          <div style="margin-top: 20px;">
            <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/login" 
               style="background-color: #28a745; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block;">
              Login to Dashboard
            </a>
          </div>
        </div>
        <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee; color: #888; font-size: 12px;">
          <p>This is an automated welcome message from NammaCompliance. Please do not reply to this email.</p>
        </div>
      </div>
    </div>
  `;

  return sendEmail({
    to: user.email,
    subject,
    text,
    html
  });
}

module.exports = {
  sendEmail,
  sendGSTReminder,
  sendCaseUpdateNotification,
  sendWelcomeEmail
};
