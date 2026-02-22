CREATE DATABASE IF NOT EXISTS workshop_db;
USE workshop_db;

-- Reset existing tables to ensure correct schema
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS bill_items;
DROP TABLE IF EXISTS bills;
DROP TABLE IF EXISTS customers;
DROP TABLE IF EXISTS items;
SET FOREIGN_KEY_CHECKS = 1;

-- Items table
CREATE TABLE IF NOT EXISTS items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  size VARCHAR(50),
  price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  quantity INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Customers table
CREATE TABLE IF NOT EXISTS customers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  gst_id VARCHAR(50),
  phone VARCHAR(20),
  address VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Bills table
CREATE TABLE IF NOT EXISTS bills (
  id INT AUTO_INCREMENT PRIMARY KEY,
  bill_number VARCHAR(50) NOT NULL UNIQUE,
  bill_date DATE NOT NULL,
  customer_id INT NOT NULL,
  subtotal DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  gst_percent DECIMAL(5,2) NOT NULL DEFAULT 18.00,
  gst_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  discount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  grand_total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Bill items table
CREATE TABLE IF NOT EXISTS bill_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  bill_id INT NOT NULL,
  item_id INT NOT NULL,
  size VARCHAR(50),
  quantity INT NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  total DECIMAL(12,2) NOT NULL,
  FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Sample data
INSERT INTO items (name, size, price, quantity) VALUES
('Wrench Set', 'M', 1500.00, 50),
('Hammer', 'L', 800.00, 100),
('Screwdriver', 'S', 200.00, 200),
('Pliers', 'M', 450.00, 80);

INSERT INTO customers (name, gst_id, phone, address) VALUES
('ABC Motors', '27ABCDE1234F1Z5', '9876543210', '12 Industrial Area, Pune'),
('XYZ Workshop', '27XYZAB5678C1Z9', '9123456780', '45 Service Lane, Mumbai'),
('QuickFix Garage', '27QFGRG1234H1Z2', '9988776655', '78 Repair Road, Nagpur');
