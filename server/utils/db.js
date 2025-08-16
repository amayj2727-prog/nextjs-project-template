const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbFile = path.join(__dirname, '..', 'nammacompliance.db');
let db;

function initDB() {
  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(dbFile, (err) => {
      if (err) {
        console.error('Error opening database:', err);
        return reject(err);
      }
      console.log('📁 Connected to SQLite database');
      
      // Create tables
      createTables()
        .then(() => {
          console.log('✅ Database tables initialized');
          resolve();
        })
        .catch(reject);
    });
  });
}

function createTables() {
  return new Promise((resolve, reject) => {
    const tables = [
      // Users table
      `CREATE TABLE IF NOT EXISTS Users (
        user_id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        phone TEXT UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('vendor', 'ca', 'admin')),
        language TEXT DEFAULT 'en',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      
      // Vendors table
      `CREATE TABLE IF NOT EXISTS Vendors (
        vendor_id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        business_name TEXT NOT NULL,
        business_type TEXT NOT NULL,
        turnover_range TEXT NOT NULL,
        gst_number TEXT,
        license_type TEXT,
        compliance_status TEXT DEFAULT 'pending',
        assigned_ca_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES Users (user_id),
        FOREIGN KEY (assigned_ca_id) REFERENCES Users (user_id)
      )`,
      
      // Transactions table
      `CREATE TABLE IF NOT EXISTS Transactions (
        transaction_id INTEGER PRIMARY KEY AUTOINCREMENT,
        vendor_id INTEGER NOT NULL,
        date DATE NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
        category TEXT NOT NULL,
        frequency TEXT DEFAULT 'one-time',
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (vendor_id) REFERENCES Vendors (vendor_id)
      )`,
      
      // Cases table
      `CREATE TABLE IF NOT EXISTS Cases (
        case_id INTEGER PRIMARY KEY AUTOINCREMENT,
        vendor_id INTEGER NOT NULL,
        ca_id INTEGER,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT DEFAULT 'open' CHECK (status IN ('open', 'in-progress', 'resolved')),
        priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (vendor_id) REFERENCES Vendors (vendor_id),
        FOREIGN KEY (ca_id) REFERENCES Users (user_id)
      )`,
      
      // Documents table
      `CREATE TABLE IF NOT EXISTS Documents (
        doc_id INTEGER PRIMARY KEY AUTOINCREMENT,
        vendor_id INTEGER NOT NULL,
        case_id INTEGER,
        filename TEXT NOT NULL,
        original_name TEXT NOT NULL,
        file_url TEXT NOT NULL,
        file_size INTEGER,
        mime_type TEXT,
        uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (vendor_id) REFERENCES Vendors (vendor_id),
        FOREIGN KEY (case_id) REFERENCES Cases (case_id)
      )`,
      
      // News Updates table
      `CREATE TABLE IF NOT EXISTS NewsUpdates (
        update_id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        business_type TEXT,
        posted_by INTEGER NOT NULL,
        is_global BOOLEAN DEFAULT 0,
        is_approved BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (posted_by) REFERENCES Users (user_id)
      )`,
      
      // Notifications table
      `CREATE TABLE IF NOT EXISTS Notifications (
        notif_id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        type TEXT DEFAULT 'info' CHECK (type IN ('info', 'warning', 'success', 'error')),
        channel TEXT DEFAULT 'in-app' CHECK (channel IN ('in-app', 'email', 'whatsapp')),
        is_read BOOLEAN DEFAULT 0,
        sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES Users (user_id)
      )`,
      
      // Activity Logs table
      `CREATE TABLE IF NOT EXISTS ActivityLogs (
        log_id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        details TEXT,
        ip_address TEXT,
        user_agent TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES Users (user_id)
      )`
    ];

    let completed = 0;
    const total = tables.length;

    tables.forEach((tableSQL, index) => {
      db.run(tableSQL, (err) => {
        if (err) {
          console.error(`Error creating table ${index + 1}:`, err);
          return reject(err);
        }
        completed++;
        if (completed === total) {
          resolve();
        }
      });
    });
  });
}

function getDB() {
  return db;
}

function closeDB() {
  return new Promise((resolve, reject) => {
    if (db) {
      db.close((err) => {
        if (err) {
          console.error('Error closing database:', err);
          return reject(err);
        }
        console.log('📁 Database connection closed');
        resolve();
      });
    } else {
      resolve();
    }
  });
}

module.exports = {
  initDB,
  getDB,
  closeDB
};
