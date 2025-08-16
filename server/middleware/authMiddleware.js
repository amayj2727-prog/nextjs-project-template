const jwt = require('jsonwebtoken');
const { getDB } = require('../utils/db');

const JWT_SECRET = process.env.JWT_SECRET || 'nammacompliance-secret-key-change-in-production';

function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Access token required' });
    }

    const token = authHeader.split(' ')[1];
    
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err) {
        return res.status(403).json({ error: 'Invalid or expired token' });
      }
      
      // Attach user info to request
      req.user = decoded;
      next();
    });
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Authentication error' });
  }
}

function roleMiddleware(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    
    next();
  };
}

function logActivity(action, details = null) {
  return (req, res, next) => {
    if (req.user) {
      const db = getDB();
      const logData = {
        user_id: req.user.userId,
        action,
        details: details || JSON.stringify({
          method: req.method,
          url: req.originalUrl,
          body: req.method !== 'GET' ? req.body : null
        }),
        ip_address: req.ip || req.connection.remoteAddress,
        user_agent: req.get('User-Agent')
      };
      
      db.run(
        `INSERT INTO ActivityLogs (user_id, action, details, ip_address, user_agent) 
         VALUES (?, ?, ?, ?, ?)`,
        [logData.user_id, logData.action, logData.details, logData.ip_address, logData.user_agent],
        (err) => {
          if (err) {
            console.error('Error logging activity:', err);
          }
        }
      );
    }
    next();
  };
}

module.exports = {
  authMiddleware,
  roleMiddleware,
  logActivity,
  JWT_SECRET
};
