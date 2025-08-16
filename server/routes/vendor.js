const express = require('express');
const multer = require('multer');
const path = require('path');
const { getDB } = require('../utils/db');
const { authMiddleware, roleMiddleware, logActivity } = require('../middleware/authMiddleware');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, '..', 'uploads'));
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: function (req, file, cb) {
    // Allow common document types
    const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|xls|xlsx/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only images and documents are allowed'));
    }
  }
});

// Apply auth middleware to all vendor routes
router.use(authMiddleware);
router.use(roleMiddleware(['vendor']));

// Get vendor dashboard data
router.get('/dashboard', logActivity('VIEW_VENDOR_DASHBOARD'), async (req, res, next) => {
  try {
    const db = getDB();
    const userId = req.user.userId;

    // Get vendor info
    const vendor = await new Promise((resolve, reject) => {
      db.get(
        `SELECT v.*, u.name, u.email FROM Vendors v 
         JOIN Users u ON v.user_id = u.user_id 
         WHERE v.user_id = ?`,
        [userId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (!vendor) {
      return res.status(404).json({ error: 'Vendor profile not found' });
    }

    // Get recent transactions
    const transactions = await new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM Transactions WHERE vendor_id = ? 
         ORDER BY date DESC LIMIT 10`,
        [vendor.vendor_id],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    // Get active cases
    const cases = await new Promise((resolve, reject) => {
      db.all(
        `SELECT c.*, u.name as ca_name FROM Cases c 
         LEFT JOIN Users u ON c.ca_id = u.user_id 
         WHERE c.vendor_id = ? 
         ORDER BY c.created_at DESC`,
        [vendor.vendor_id],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    // Get recent notifications
    const notifications = await new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM Notifications WHERE user_id = ? 
         ORDER BY sent_at DESC LIMIT 5`,
        [userId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    // Get business-specific news
    const news = await new Promise((resolve, reject) => {
      db.all(
        `SELECT n.*, u.name as author_name FROM NewsUpdates n 
         JOIN Users u ON n.posted_by = u.user_id 
         WHERE (n.business_type = ? OR n.is_global = 1) AND n.is_approved = 1 
         ORDER BY n.created_at DESC LIMIT 10`,
        [vendor.business_type],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    // Calculate transaction summary
    const transactionSummary = await new Promise((resolve, reject) => {
      db.get(
        `SELECT 
           SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as total_income,
           SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as total_expenses,
           COUNT(*) as total_transactions
         FROM Transactions WHERE vendor_id = ?`,
        [vendor.vendor_id],
        (err, row) => {
          if (err) reject(err);
          else resolve(row || { total_income: 0, total_expenses: 0, total_transactions: 0 });
        }
      );
    });

    res.json({
      vendor: {
        id: vendor.vendor_id,
        name: vendor.name,
        email: vendor.email,
        businessName: vendor.business_name,
        businessType: vendor.business_type,
        turnoverRange: vendor.turnover_range,
        gstNumber: vendor.gst_number,
        complianceStatus: vendor.compliance_status,
        assignedCaId: vendor.assigned_ca_id
      },
      transactions: transactions.map(t => ({
        id: t.transaction_id,
        date: t.date,
        amount: parseFloat(t.amount),
        type: t.type,
        category: t.category,
        frequency: t.frequency,
        notes: t.notes
      })),
      cases: cases.map(c => ({
        id: c.case_id,
        title: c.title,
        description: c.description,
        status: c.status,
        priority: c.priority,
        caName: c.ca_name,
        createdAt: c.created_at,
        updatedAt: c.updated_at
      })),
      notifications: notifications.map(n => ({
        id: n.notif_id,
        title: n.title,
        message: n.message,
        type: n.type,
        isRead: n.is_read,
        sentAt: n.sent_at
      })),
      news: news.map(n => ({
        id: n.update_id,
        title: n.title,
        content: n.content,
        businessType: n.business_type,
        authorName: n.author_name,
        isGlobal: n.is_global,
        createdAt: n.created_at
      })),
      summary: {
        totalIncome: parseFloat(transactionSummary.total_income) || 0,
        totalExpenses: parseFloat(transactionSummary.total_expenses) || 0,
        totalTransactions: transactionSummary.total_transactions || 0,
        netAmount: (parseFloat(transactionSummary.total_income) || 0) - (parseFloat(transactionSummary.total_expenses) || 0)
      }
    });

  } catch (error) {
    console.error('Vendor dashboard error:', error);
    next(error);
  }
});

// Add transaction
router.post('/transaction', logActivity('ADD_TRANSACTION'), async (req, res, next) => {
  try {
    const { amount, type, category, frequency = 'one-time', notes, date } = req.body;
    const userId = req.user.userId;

    if (!amount || !type || !category || !date) {
      return res.status(400).json({ 
        error: 'Missing required fields: amount, type, category, date' 
      });
    }

    if (!['income', 'expense'].includes(type)) {
      return res.status(400).json({ 
        error: 'Type must be either income or expense' 
      });
    }

    const db = getDB();

    // Get vendor ID
    const vendor = await new Promise((resolve, reject) => {
      db.get('SELECT vendor_id FROM Vendors WHERE user_id = ?', [userId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!vendor) {
      return res.status(404).json({ error: 'Vendor profile not found' });
    }

    // Insert transaction
    const transactionId = await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO Transactions (vendor_id, date, amount, type, category, frequency, notes) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [vendor.vendor_id, date, amount, type, category, frequency, notes],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });

    res.status(201).json({
      message: 'Transaction added successfully',
      transaction: {
        id: transactionId,
        date,
        amount: parseFloat(amount),
        type,
        category,
        frequency,
        notes
      }
    });

  } catch (error) {
    console.error('Add transaction error:', error);
    next(error);
  }
});

// Get all transactions
router.get('/transactions', logActivity('VIEW_TRANSACTIONS'), async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { page = 1, limit = 20, type, category, startDate, endDate } = req.query;
    const offset = (page - 1) * limit;

    const db = getDB();

    // Get vendor ID
    const vendor = await new Promise((resolve, reject) => {
      db.get('SELECT vendor_id FROM Vendors WHERE user_id = ?', [userId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!vendor) {
      return res.status(404).json({ error: 'Vendor profile not found' });
    }

    // Build query with filters
    let query = 'SELECT * FROM Transactions WHERE vendor_id = ?';
    let params = [vendor.vendor_id];

    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }

    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }

    if (startDate) {
      query += ' AND date >= ?';
      params.push(startDate);
    }

    if (endDate) {
      query += ' AND date <= ?';
      params.push(endDate);
    }

    query += ' ORDER BY date DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const transactions = await new Promise((resolve, reject) => {
      db.all(query, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) as total FROM Transactions WHERE vendor_id = ?';
    let countParams = [vendor.vendor_id];

    if (type) {
      countQuery += ' AND type = ?';
      countParams.push(type);
    }

    if (category) {
      countQuery += ' AND category = ?';
      countParams.push(category);
    }

    if (startDate) {
      countQuery += ' AND date >= ?';
      countParams.push(startDate);
    }

    if (endDate) {
      countQuery += ' AND date <= ?';
      countParams.push(endDate);
    }

    const totalCount = await new Promise((resolve, reject) => {
      db.get(countQuery, countParams, (err, row) => {
        if (err) reject(err);
        else resolve(row.total);
      });
    });

    res.json({
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
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        pages: Math.ceil(totalCount / limit)
      }
    });

  } catch (error) {
    console.error('Get transactions error:', error);
    next(error);
  }
});

// Open new case
router.post('/case', upload.single('file'), logActivity('OPEN_CASE'), async (req, res, next) => {
  try {
    const { title, description, priority = 'medium' } = req.body;
    const userId = req.user.userId;

    if (!title || !description) {
      return res.status(400).json({ 
        error: 'Title and description are required' 
      });
    }

    const db = getDB();

    // Get vendor info
    const vendor = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM Vendors WHERE user_id = ?', [userId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!vendor) {
      return res.status(404).json({ error: 'Vendor profile not found' });
    }

    // Auto-assign CA based on business type (simplified logic)
    const assignedCA = await new Promise((resolve, reject) => {
      db.get(
        'SELECT user_id FROM Users WHERE role = "ca" ORDER BY RANDOM() LIMIT 1',
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    // Insert case
    const caseId = await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO Cases (vendor_id, ca_id, title, description, priority) 
         VALUES (?, ?, ?, ?, ?)`,
        [vendor.vendor_id, assignedCA?.user_id, title, description, priority],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });

    // Handle file upload if present
    let fileUrl = null;
    if (req.file) {
      fileUrl = `/uploads/${req.file.filename}`;
      
      // Save document record
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO Documents (vendor_id, case_id, filename, original_name, file_url, file_size, mime_type) 
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [vendor.vendor_id, caseId, req.file.filename, req.file.originalname, fileUrl, req.file.size, req.file.mimetype],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    }

    res.status(201).json({
      message: 'Case opened successfully',
      case: {
        id: caseId,
        title,
        description,
        priority,
        status: 'open',
        assignedCAId: assignedCA?.user_id,
        fileUrl
      }
    });

  } catch (error) {
    console.error('Open case error:', error);
    next(error);
  }
});

// Upload document
router.post('/upload', upload.single('file'), logActivity('UPLOAD_DOCUMENT'), async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { caseId } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const db = getDB();

    // Get vendor info
    const vendor = await new Promise((resolve, reject) => {
      db.get('SELECT vendor_id FROM Vendors WHERE user_id = ?', [userId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!vendor) {
      return res.status(404).json({ error: 'Vendor profile not found' });
    }

    const fileUrl = `/uploads/${req.file.filename}`;

    // Save document record
    const docId = await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO Documents (vendor_id, case_id, filename, original_name, file_url, file_size, mime_type) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [vendor.vendor_id, caseId || null, req.file.filename, req.file.originalname, fileUrl, req.file.size, req.file.mimetype],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });

    res.status(201).json({
      message: 'Document uploaded successfully',
      document: {
        id: docId,
        filename: req.file.filename,
        originalName: req.file.originalname,
        fileUrl,
        fileSize: req.file.size,
        mimeType: req.file.mimetype
      }
    });

  } catch (error) {
    console.error('Upload document error:', error);
    next(error);
  }
});

// Get business-specific news
router.get('/news', logActivity('VIEW_NEWS'), async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    const db = getDB();

    // Get vendor business type
    const vendor = await new Promise((resolve, reject) => {
      db.get('SELECT business_type FROM Vendors WHERE user_id = ?', [userId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!vendor) {
      return res.status(404).json({ error: 'Vendor profile not found' });
    }

    // Get news updates
    const news = await new Promise((resolve, reject) => {
      db.all(
        `SELECT n.*, u.name as author_name FROM NewsUpdates n 
         JOIN Users u ON n.posted_by = u.user_id 
         WHERE (n.business_type = ? OR n.is_global = 1) AND n.is_approved = 1 
         ORDER BY n.created_at DESC LIMIT ? OFFSET ?`,
        [vendor.business_type, parseInt(limit), parseInt(offset)],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    res.json({
      news: news.map(n => ({
        id: n.update_id,
        title: n.title,
        content: n.content,
        businessType: n.business_type,
        authorName: n.author_name,
        isGlobal: n.is_global,
        createdAt: n.created_at,
        updatedAt: n.updated_at
      }))
    });

  } catch (error) {
    console.error('Get news error:', error);
    next(error);
  }
});

module.exports = router;
