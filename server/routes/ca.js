const express = require('express');
const { getDB } = require('../utils/db');
const { authMiddleware, roleMiddleware, logActivity } = require('../middleware/authMiddleware');

const router = express.Router();

// Apply auth middleware to all CA routes
router.use(authMiddleware);
router.use(roleMiddleware(['ca']));

// Get CA dashboard data
router.get('/dashboard', logActivity('VIEW_CA_DASHBOARD'), async (req, res, next) => {
  try {
    const db = getDB();
    const userId = req.user.userId;

    // Get assigned vendors
    const assignedVendors = await new Promise((resolve, reject) => {
      db.all(
        `SELECT v.*, u.name, u.email FROM Vendors v 
         JOIN Users u ON v.user_id = u.user_id 
         WHERE v.assigned_ca_id = ?
         ORDER BY v.created_at DESC`,
        [userId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    // Get cases assigned to this CA
    const cases = await new Promise((resolve, reject) => {
      db.all(
        `SELECT c.*, v.business_name, u.name as vendor_name FROM Cases c 
         JOIN Vendors v ON c.vendor_id = v.vendor_id 
         JOIN Users u ON v.user_id = u.user_id 
         WHERE c.ca_id = ? 
         ORDER BY c.created_at DESC`,
        [userId],
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
         FROM Cases WHERE ca_id = ?`,
        [userId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row || { total_cases: 0, open_cases: 0, in_progress_cases: 0, resolved_cases: 0 });
        }
      );
    });

    // Get recent activity
    const recentActivity = await new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM ActivityLogs WHERE user_id = ? 
         ORDER BY timestamp DESC LIMIT 10`,
        [userId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    res.json({
      assignedVendors: assignedVendors.map(v => ({
        id: v.vendor_id,
        name: v.name,
        email: v.email,
        businessName: v.business_name,
        businessType: v.business_type,
        turnoverRange: v.turnover_range,
        complianceStatus: v.compliance_status,
        createdAt: v.created_at
      })),
      cases: cases.map(c => ({
        id: c.case_id,
        title: c.title,
        description: c.description,
        status: c.status,
        priority: c.priority,
        vendorName: c.vendor_name,
        businessName: c.business_name,
        createdAt: c.created_at,
        updatedAt: c.updated_at
      })),
      statistics: {
        totalVendors: assignedVendors.length,
        totalCases: caseStats.total_cases,
        openCases: caseStats.open_cases,
        inProgressCases: caseStats.in_progress_cases,
        resolvedCases: caseStats.resolved_cases
      },
      recentActivity: recentActivity.map(a => ({
        id: a.log_id,
        action: a.action,
        details: a.details,
        timestamp: a.timestamp
      }))
    });

  } catch (error) {
    console.error('CA dashboard error:', error);
    next(error);
  }
});

// Get all cases assigned to CA
router.get('/cases', logActivity('VIEW_CA_CASES'), async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { status, priority, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const db = getDB();

    // Build query with filters
    let query = `SELECT c.*, v.business_name, u.name as vendor_name, u.email as vendor_email 
                 FROM Cases c 
                 JOIN Vendors v ON c.vendor_id = v.vendor_id 
                 JOIN Users u ON v.user_id = u.user_id 
                 WHERE c.ca_id = ?`;
    let params = [userId];

    if (status) {
      query += ' AND c.status = ?';
      params.push(status);
    }

    if (priority) {
      query += ' AND c.priority = ?';
      params.push(priority);
    }

    query += ' ORDER BY c.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const cases = await new Promise((resolve, reject) => {
      db.all(query, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) as total FROM Cases WHERE ca_id = ?';
    let countParams = [userId];

    if (status) {
      countQuery += ' AND status = ?';
      countParams.push(status);
    }

    if (priority) {
      countQuery += ' AND priority = ?';
      countParams.push(priority);
    }

    const totalCount = await new Promise((resolve, reject) => {
      db.get(countQuery, countParams, (err, row) => {
        if (err) reject(err);
        else resolve(row.total);
      });
    });

    res.json({
      cases: cases.map(c => ({
        id: c.case_id,
        title: c.title,
        description: c.description,
        status: c.status,
        priority: c.priority,
        vendorId: c.vendor_id,
        vendorName: c.vendor_name,
        vendorEmail: c.vendor_email,
        businessName: c.business_name,
        createdAt: c.created_at,
        updatedAt: c.updated_at
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        pages: Math.ceil(totalCount / limit)
      }
    });

  } catch (error) {
    console.error('Get CA cases error:', error);
    next(error);
  }
});

// Update case status
router.patch('/case/:id', logActivity('UPDATE_CASE'), async (req, res, next) => {
  try {
    const caseId = req.params.id;
    const userId = req.user.userId;
    const { status, priority, comment } = req.body;

    if (!status && !priority && !comment) {
      return res.status(400).json({ 
        error: 'At least one field (status, priority, or comment) is required' 
      });
    }

    const db = getDB();

    // Verify case belongs to this CA
    const caseInfo = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM Cases WHERE case_id = ? AND ca_id = ?', [caseId, userId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!caseInfo) {
      return res.status(404).json({ error: 'Case not found or not assigned to you' });
    }

    // Build update query
    let updateFields = [];
    let updateParams = [];

    if (status) {
      if (!['open', 'in-progress', 'resolved'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
      updateFields.push('status = ?');
      updateParams.push(status);
    }

    if (priority) {
      if (!['low', 'medium', 'high'].includes(priority)) {
        return res.status(400).json({ error: 'Invalid priority' });
      }
      updateFields.push('priority = ?');
      updateParams.push(priority);
    }

    updateFields.push('updated_at = CURRENT_TIMESTAMP');
    updateParams.push(caseId);

    // Update case
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE Cases SET ${updateFields.join(', ')} WHERE case_id = ?`,
        updateParams,
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // Add comment as notification if provided
    if (comment) {
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO Notifications (user_id, title, message, type) 
           VALUES (?, ?, ?, ?)`,
          [caseInfo.vendor_id, `Case Update: ${caseInfo.title}`, comment, 'info'],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    }

    res.json({
      message: 'Case updated successfully',
      caseId: parseInt(caseId),
      updates: {
        ...(status && { status }),
        ...(priority && { priority }),
        ...(comment && { comment })
      }
    });

  } catch (error) {
    console.error('Update case error:', error);
    next(error);
  }
});

// Get vendor transactions for GST filing
router.get('/vendor/:vendorId/transactions', logActivity('VIEW_VENDOR_TRANSACTIONS'), async (req, res, next) => {
  try {
    const vendorId = req.params.vendorId;
    const userId = req.user.userId;
    const { startDate, endDate, type, format } = req.query;

    const db = getDB();

    // Verify vendor is assigned to this CA
    const vendor = await new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM Vendors WHERE vendor_id = ? AND assigned_ca_id = ?',
        [vendorId, userId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (!vendor) {
      return res.status(404).json({ error: 'Vendor not found or not assigned to you' });
    }

    // Build query with filters
    let query = 'SELECT * FROM Transactions WHERE vendor_id = ?';
    let params = [vendorId];

    if (startDate) {
      query += ' AND date >= ?';
      params.push(startDate);
    }

    if (endDate) {
      query += ' AND date <= ?';
      params.push(endDate);
    }

    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }

    query += ' ORDER BY date DESC';

    const transactions = await new Promise((resolve, reject) => {
      db.all(query, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    // Calculate summary
    const summary = transactions.reduce((acc, t) => {
      if (t.type === 'income') {
        acc.totalIncome += parseFloat(t.amount);
      } else {
        acc.totalExpenses += parseFloat(t.amount);
      }
      acc.totalTransactions++;
      return acc;
    }, { totalIncome: 0, totalExpenses: 0, totalTransactions: 0 });

    summary.netAmount = summary.totalIncome - summary.totalExpenses;

    const response = {
      vendor: {
        id: vendor.vendor_id,
        businessName: vendor.business_name,
        businessType: vendor.business_type,
        turnoverRange: vendor.turnover_range,
        gstNumber: vendor.gst_number
      },
      transactions: transactions.map(t => ({
        id: t.transaction_id,
        date: t.date,
        amount: parseFloat(t.amount),
        type: t.type,
        category: t.category,
        frequency: t.frequency,
        notes: t.notes,
        createdAt: t.created_at
      })),
      summary,
      period: {
        startDate,
        endDate,
        type
      }
    };

    res.json(response);

  } catch (error) {
    console.error('Get vendor transactions error:', error);
    next(error);
  }
});

// Post news update
router.post('/news', logActivity('POST_NEWS'), async (req, res, next) => {
  try {
    const { title, content, businessType, isGlobal = false } = req.body;
    const userId = req.user.userId;

    if (!title || !content) {
      return res.status(400).json({ 
        error: 'Title and content are required' 
      });
    }

    if (!isGlobal && !businessType) {
      return res.status(400).json({ 
        error: 'Business type is required for non-global news' 
      });
    }

    const db = getDB();

    // Insert news update (requires admin approval)
    const newsId = await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO NewsUpdates (title, content, business_type, posted_by, is_global, is_approved) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [title, content, businessType, userId, isGlobal ? 1 : 0, 0], // Not approved by default
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });

    res.status(201).json({
      message: 'News update posted successfully (pending admin approval)',
      news: {
        id: newsId,
        title,
        content,
        businessType,
        isGlobal,
        isApproved: false
      }
    });

  } catch (error) {
    console.error('Post news error:', error);
    next(error);
  }
});

// Get CA's posted news
router.get('/news', logActivity('VIEW_CA_NEWS'), async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    const db = getDB();

    const news = await new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM NewsUpdates WHERE posted_by = ? 
         ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [userId, parseInt(limit), parseInt(offset)],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    const totalCount = await new Promise((resolve, reject) => {
      db.get(
        'SELECT COUNT(*) as total FROM NewsUpdates WHERE posted_by = ?',
        [userId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row.total);
        }
      );
    });

    res.json({
      news: news.map(n => ({
        id: n.update_id,
        title: n.title,
        content: n.content,
        businessType: n.business_type,
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
    console.error('Get CA news error:', error);
    next(error);
  }
});

module.exports = router;
