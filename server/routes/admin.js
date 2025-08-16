const express = require('express');
const { getDB } = require('../utils/db');
const { authMiddleware, roleMiddleware, logActivity } = require('../middleware/authMiddleware');

const router = express.Router();

// Apply auth middleware to all admin routes
router.use(authMiddleware);
router.use(roleMiddleware(['admin']));

// Get admin dashboard with analytics
router.get('/dashboard', logActivity('VIEW_ADMIN_DASHBOARD'), async (req, res, next) => {
  try {
    const db = getDB();

    // Get user statistics
    const userStats = await new Promise((resolve, reject) => {
      db.get(
        `SELECT 
           COUNT(*) as total_users,
           SUM(CASE WHEN role = 'vendor' THEN 1 ELSE 0 END) as total_vendors,
           SUM(CASE WHEN role = 'ca' THEN 1 ELSE 0 END) as total_cas,
           SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) as total_admins
         FROM Users`,
        (err, row) => {
          if (err) reject(err);
          else resolve(row || {});
        }
      );
    });

    // Get vendor statistics by business type
    const vendorsByType = await new Promise((resolve, reject) => {
      db.all(
        `SELECT business_type, COUNT(*) as count 
         FROM Vendors 
         GROUP BY business_type 
         ORDER BY count DESC`,
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    // Get vendor statistics by turnover range
    const vendorsByTurnover = await new Promise((resolve, reject) => {
      db.all(
        `SELECT turnover_range, COUNT(*) as count 
         FROM Vendors 
         GROUP BY turnover_range 
         ORDER BY count DESC`,
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    // Get case statistics
    const caseStats = await new Promise((resolve, reject) => {
      db.get(
        `SELECT 
           COUNT(*) as total_cases,
           SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_cases,
           SUM(CASE WHEN status = 'in-progress' THEN 1 ELSE 0 END) as in_progress_cases,
           SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved_cases
         FROM Cases`,
        (err, row) => {
          if (err) reject(err);
          else resolve(row || {});
        }
      );
    });

    // Get compliance status distribution
    const complianceStats = await new Promise((resolve, reject) => {
      db.all(
        `SELECT compliance_status, COUNT(*) as count 
         FROM Vendors 
         GROUP BY compliance_status`,
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    // Get recent activity
    const recentActivity = await new Promise((resolve, reject) => {
      db.all(
        `SELECT a.*, u.name, u.role FROM ActivityLogs a 
         JOIN Users u ON a.user_id = u.user_id 
         ORDER BY a.timestamp DESC LIMIT 20`,
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    // Get monthly registration trends (last 6 months)
    const registrationTrends = await new Promise((resolve, reject) => {
      db.all(
        `SELECT 
           strftime('%Y-%m', created_at) as month,
           role,
           COUNT(*) as count
         FROM Users 
         WHERE created_at >= date('now', '-6 months')
         GROUP BY strftime('%Y-%m', created_at), role
         ORDER BY month DESC`,
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    // Calculate compliance success rate
    const totalVendors = userStats.total_vendors || 0;
    const compliantVendors = complianceStats.find(c => c.compliance_status === 'compliant')?.count || 0;
    const complianceSuccessRate = totalVendors > 0 ? (compliantVendors / totalVendors * 100).toFixed(2) : 0;

    res.json({
      userStatistics: {
        totalUsers: userStats.total_users || 0,
        totalVendors: userStats.total_vendors || 0,
        totalCAs: userStats.total_cas || 0,
        totalAdmins: userStats.total_admins || 0
      },
      vendorAnalytics: {
        byBusinessType: vendorsByType.map(v => ({
          businessType: v.business_type,
          count: v.count
        })),
        byTurnoverRange: vendorsByTurnover.map(v => ({
          turnoverRange: v.turnover_range,
          count: v.count
        })),
        complianceDistribution: complianceStats.map(c => ({
          status: c.compliance_status,
          count: c.count
        })),
        complianceSuccessRate: parseFloat(complianceSuccessRate)
      },
      caseStatistics: {
        totalCases: caseStats.total_cases || 0,
        openCases: caseStats.open_cases || 0,
        inProgressCases: caseStats.in_progress_cases || 0,
        resolvedCases: caseStats.resolved_cases || 0,
        resolutionRate: caseStats.total_cases > 0 ? 
          ((caseStats.resolved_cases || 0) / caseStats.total_cases * 100).toFixed(2) : 0
      },
      registrationTrends: registrationTrends.map(r => ({
        month: r.month,
        role: r.role,
        count: r.count
      })),
      recentActivity: recentActivity.map(a => ({
        id: a.log_id,
        userName: a.name,
        userRole: a.role,
        action: a.action,
        details: a.details,
        timestamp: a.timestamp
      }))
    });

  } catch (error) {
    console.error('Admin dashboard error:', error);
    next(error);
  }
});

// Get all users with pagination and filters
router.get('/users', logActivity('VIEW_ALL_USERS'), async (req, res, next) => {
  try {
    const { role, page = 1, limit = 20, search } = req.query;
    const offset = (page - 1) * limit;

    const db = getDB();

    // Build query with filters
    let query = 'SELECT u.*, v.business_name, v.business_type FROM Users u LEFT JOIN Vendors v ON u.user_id = v.user_id WHERE 1=1';
    let params = [];

    if (role) {
      query += ' AND u.role = ?';
      params.push(role);
    }

    if (search) {
      query += ' AND (u.name LIKE ? OR u.email LIKE ? OR v.business_name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY u.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const users = await new Promise((resolve, reject) => {
      db.all(query, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) as total FROM Users u LEFT JOIN Vendors v ON u.user_id = v.user_id WHERE 1=1';
    let countParams = [];

    if (role) {
      countQuery += ' AND u.role = ?';
      countParams.push(role);
    }

    if (search) {
      countQuery += ' AND (u.name LIKE ? OR u.email LIKE ? OR v.business_name LIKE ?)';
      countParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const totalCount = await new Promise((resolve, reject) => {
      db.get(countQuery, countParams, (err, row) => {
        if (err) reject(err);
        else resolve(row.total);
      });
    });

    res.json({
      users: users.map(u => ({
        id: u.user_id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        role: u.role,
        language: u.language,
        businessName: u.business_name,
        businessType: u.business_type,
        createdAt: u.created_at
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        pages: Math.ceil(totalCount / limit)
      }
    });

  } catch (error) {
    console.error('Get users error:', error);
    next(error);
  }
});

// Assign vendor to CA
router.post('/assign', logActivity('ASSIGN_VENDOR_TO_CA'), async (req, res, next) => {
  try {
    const { vendorId, caId } = req.body;

    if (!vendorId || !caId) {
      return res.status(400).json({ 
        error: 'Vendor ID and CA ID are required' 
      });
    }

    const db = getDB();

    // Verify vendor exists
    const vendor = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM Vendors WHERE vendor_id = ?', [vendorId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!vendor) {
      return res.status(404).json({ error: 'Vendor not found' });
    }

    // Verify CA exists
    const ca = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM Users WHERE user_id = ? AND role = "ca"', [caId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!ca) {
      return res.status(404).json({ error: 'CA not found' });
    }

    // Update vendor assignment
    await new Promise((resolve, reject) => {
      db.run(
        'UPDATE Vendors SET assigned_ca_id = ? WHERE vendor_id = ?',
        [caId, vendorId],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // Create notification for vendor
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO Notifications (user_id, title, message, type) 
         VALUES (?, ?, ?, ?)`,
        [vendor.user_id, 'CA Assignment', `You have been assigned to CA: ${ca.name}`, 'info'],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // Create notification for CA
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO Notifications (user_id, title, message, type) 
         VALUES (?, ?, ?, ?)`,
        [caId, 'New Vendor Assignment', `You have been assigned vendor: ${vendor.business_name}`, 'info'],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    res.json({
      message: 'Vendor assigned to CA successfully',
      assignment: {
        vendorId,
        caId,
        vendorName: vendor.business_name,
        caName: ca.name
      }
    });

  } catch (error) {
    console.error('Assign vendor error:', error);
    next(error);
  }
});

// Get system activity logs
router.get('/logs', logActivity('VIEW_SYSTEM_LOGS'), async (req, res, next) => {
  try {
    const { userId, action, page = 1, limit = 50, startDate, endDate } = req.query;
    const offset = (page - 1) * limit;

    const db = getDB();

    // Build query with filters
    let query = `SELECT a.*, u.name, u.email, u.role FROM ActivityLogs a 
                 JOIN Users u ON a.user_id = u.user_id WHERE 1=1`;
    let params = [];

    if (userId) {
      query += ' AND a.user_id = ?';
      params.push(userId);
    }

    if (action) {
      query += ' AND a.action LIKE ?';
      params.push(`%${action}%`);
    }

    if (startDate) {
      query += ' AND a.timestamp >= ?';
      params.push(startDate);
    }

    if (endDate) {
      query += ' AND a.timestamp <= ?';
      params.push(endDate);
    }

    query += ' ORDER BY a.timestamp DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const logs = await new Promise((resolve, reject) => {
      db.all(query, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) as total FROM ActivityLogs a JOIN Users u ON a.user_id = u.user_id WHERE 1=1';
    let countParams = [];

    if (userId) {
      countQuery += ' AND a.user_id = ?';
      countParams.push(userId);
    }

    if (action) {
      countQuery += ' AND a.action LIKE ?';
      countParams.push(`%${action}%`);
    }

    if (startDate) {
      countQuery += ' AND a.timestamp >= ?';
      countParams.push(startDate);
    }

    if (endDate) {
      countQuery += ' AND a.timestamp <= ?';
      countParams.push(endDate);
    }

    const totalCount = await new Promise((resolve, reject) => {
      db.get(countQuery, countParams, (err, row) => {
        if (err) reject(err);
        else resolve(row.total);
      });
    });

    res.json({
      logs: logs.map(l => ({
        id: l.log_id,
        userId: l.user_id,
        userName: l.name,
        userEmail: l.email,
        userRole: l.role,
        action: l.action,
        details: l.details,
        ipAddress: l.ip_address,
        userAgent: l.user_agent,
        timestamp: l.timestamp
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        pages: Math.ceil(totalCount / limit)
      }
    });

  } catch (error) {
    console.error('Get logs error:', error);
    next(error);
  }
});

// Broadcast notification
router.post('/broadcast', logActivity('BROADCAST_NOTIFICATION'), async (req, res, next) => {
  try {
    const { title, message, targetRole, channel = 'in-app' } = req.body;

    if (!title || !message) {
      return res.status(400).json({ 
        error: 'Title and message are required' 
      });
    }

    if (!['in-app', 'email', 'whatsapp'].includes(channel)) {
      return res.status(400).json({ 
        error: 'Invalid channel. Must be in-app, email, or whatsapp' 
      });
    }

    const db = getDB();

    // Get target users
    let userQuery = 'SELECT user_id FROM Users';
    let userParams = [];

    if (targetRole) {
      userQuery += ' WHERE role = ?';
      userParams.push(targetRole);
    }

    const targetUsers = await new Promise((resolve, reject) => {
      db.all(userQuery, userParams, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    if (targetUsers.length === 0) {
      return res.status(404).json({ error: 'No target users found' });
    }

    // Insert notifications for all target users
    const insertPromises = targetUsers.map(user => {
      return new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO Notifications (user_id, title, message, channel) 
           VALUES (?, ?, ?, ?)`,
          [user.user_id, title, message, channel],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    });

    await Promise.all(insertPromises);

    res.json({
      message: 'Broadcast notification sent successfully',
      broadcast: {
        title,
        message,
        targetRole: targetRole || 'all',
        channel,
        recipientCount: targetUsers.length
      }
    });

  } catch (error) {
    console.error('Broadcast notification error:', error);
    next(error);
  }
});

// Post global news
router.post('/news', logActivity('POST_GLOBAL_NEWS'), async (req, res, next) => {
  try {
    const { title, content, businessType, isGlobal = true } = req.body;
    const userId = req.user.userId;

    if (!title || !content) {
      return res.status(400).json({ 
        error: 'Title and content are required' 
      });
    }

    const db = getDB();

    // Insert news update (auto-approved for admin)
    const newsId = await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO NewsUpdates (title, content, business_type, posted_by, is_global, is_approved) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [title, content, businessType, userId, isGlobal ? 1 : 0, 1], // Auto-approved
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });

    res.status(201).json({
      message: 'Global news posted successfully',
      news: {
        id: newsId,
        title,
        content,
        businessType,
        isGlobal,
        isApproved: true
      }
    });

  } catch (error) {
    console.error('Post global news error:', error);
    next(error);
  }
});

// Approve/reject CA news
router.patch('/news/:id/approve', logActivity('APPROVE_NEWS'), async (req, res, next) => {
  try {
    const newsId = req.params.id;
    const { approved } = req.body;

    if (typeof approved !== 'boolean') {
      return res.status(400).json({ 
        error: 'Approved field must be a boolean' 
      });
    }

    const db = getDB();

    // Update news approval status
    await new Promise((resolve, reject) => {
      db.run(
        'UPDATE NewsUpdates SET is_approved = ?, updated_at = CURRENT_TIMESTAMP WHERE update_id = ?',
        [approved ? 1 : 0, newsId],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    res.json({
      message: `News ${approved ? 'approved' : 'rejected'} successfully`,
      newsId: parseInt(newsId),
      approved
    });

  } catch (error) {
    console.error('Approve news error:', error);
    next(error);
  }
});

// Get all news updates for management
router.get('/news', logActivity('VIEW_ALL_NEWS'), async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const db = getDB();

    // Build query with filters
    let query = `SELECT n.*, u.name as author_name FROM NewsUpdates n 
                 JOIN Users u ON n.posted_by = u.user_id WHERE 1=1`;
    let params = [];

    if (status === 'pending') {
      query += ' AND n.is_approved = 0';
    } else if (status === 'approved') {
      query += ' AND n.is_approved = 1';
    }

    query += ' ORDER BY n.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const news = await new Promise((resolve, reject) => {
      db.all(query, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) as total FROM NewsUpdates WHERE 1=1';
    let countParams = [];

    if (status === 'pending') {
      countQuery += ' AND is_approved = 0';
    } else if (status === 'approved') {
      countQuery += ' AND is_approved = 1';
    }

    const totalCount = await new Promise((resolve, reject) => {
      db.get(countQuery, countParams, (err, row) => {
        if (err) reject(err);
        else resolve(row.total);
      });
    });

    res.json({
      news: news.map(n => ({
        id: n.update_id,
        title: n.title,
        content: n.content,
        businessType: n.business_type,
        authorName: n.author_name,
        isGlobal: n.is_global,
        isApproved: n.is_approved,
        createdAt: n.created_at,
        updatedAt: n.updated_at
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        pages: Math.ceil(totalCount / limit)
      }
    });

  } catch (error) {
    console.error('Get all news error:', error);
    next(error);
  }
});

module.exports = router;
