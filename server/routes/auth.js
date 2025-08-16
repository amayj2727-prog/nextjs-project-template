const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { getDB } = require('../utils/db');
const { JWT_SECRET } = require('../middleware/authMiddleware');

const router = express.Router();

// Register endpoint
router.post('/register', async (req, res, next) => {
  try {
    const { 
      name, 
      email, 
      phone, 
      password, 
      role, 
      businessName, 
      businessType, 
      turnoverRange,
      language = 'en'
    } = req.body;

    // Validation
    if (!name || !email || !password || !role) {
      return res.status(400).json({ 
        error: 'Missing required fields: name, email, password, role' 
      });
    }

    if (!['vendor', 'ca', 'admin'].includes(role)) {
      return res.status(400).json({ 
        error: 'Invalid role. Must be vendor, ca, or admin' 
      });
    }

    if (role === 'vendor' && (!businessName || !businessType || !turnoverRange)) {
      return res.status(400).json({ 
        error: 'Vendor registration requires businessName, businessType, and turnoverRange' 
      });
    }

    const db = getDB();

    // Check if user already exists
    const existingUser = await new Promise((resolve, reject) => {
      db.get(
        'SELECT user_id FROM Users WHERE email = ? OR phone = ?',
        [email, phone],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (existingUser) {
      return res.status(409).json({ 
        error: 'User with this email or phone already exists' 
      });
    }

    // Hash password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Insert user
    const userId = await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO Users (name, email, phone, password_hash, role, language) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [name, email, phone, passwordHash, role, language],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });

    // If vendor, create vendor record
    if (role === 'vendor') {
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO Vendors (user_id, business_name, business_type, turnover_range) 
           VALUES (?, ?, ?, ?)`,
          [userId, businessName, businessType, turnoverRange],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        userId, 
        role, 
        email,
        name 
      }, 
      JWT_SECRET, 
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        userId,
        name,
        email,
        role,
        language
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    next(error);
  }
});

// Login endpoint
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ 
        error: 'Email and password are required' 
      });
    }

    const db = getDB();

    // Find user
    const user = await new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM Users WHERE email = ?',
        [email],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (!user) {
      return res.status(401).json({ 
        error: 'Invalid email or password' 
      });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!isValidPassword) {
      return res.status(401).json({ 
        error: 'Invalid email or password' 
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: user.user_id, 
        role: user.role, 
        email: user.email,
        name: user.name 
      }, 
      JWT_SECRET, 
      { expiresIn: '7d' }
    );

    // Get additional info for vendors
    let vendorInfo = null;
    if (user.role === 'vendor') {
      vendorInfo = await new Promise((resolve, reject) => {
        db.get(
          'SELECT * FROM Vendors WHERE user_id = ?',
          [user.user_id],
          (err, row) => {
            if (err) reject(err);
            else resolve(row);
          }
        );
      });
    }

    res.json({
      message: 'Login successful',
      token,
      user: {
        userId: user.user_id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        language: user.language,
        ...(vendorInfo && { 
          vendorId: vendorInfo.vendor_id,
          businessName: vendorInfo.business_name,
          businessType: vendorInfo.business_type,
          turnoverRange: vendorInfo.turnover_range
        })
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    next(error);
  }
});

// Verify token endpoint
router.get('/verify', (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ 
      valid: true, 
      user: decoded 
    });
  } catch (error) {
    res.status(401).json({ 
      valid: false, 
      error: 'Invalid token' 
    });
  }
});

module.exports = router;
