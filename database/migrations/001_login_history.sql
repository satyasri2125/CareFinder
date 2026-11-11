-- Run this ONCE in the existing TiDB carefinder database.
-- Safe to run more than once; it does not delete existing records.
USE carefinder;
CREATE TABLE IF NOT EXISTS login_history (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  email VARCHAR(150) NOT NULL,
  event_type ENUM('register','login') NOT NULL,
  ip_address VARCHAR(45),
  user_agent VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_login_history_user_id (user_id),
  INDEX idx_login_history_created_at (created_at)
);
