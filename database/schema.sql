-- CareFinder - Smart Nearby Hospital Finder
-- MySQL schema + DEMO / SAMPLE data (not live hospital data).
-- Run this file once in the TiDB SQL Editor after selecting the carefinder database.
-- IMPORTANT: This script does not drop existing tables or user records.

CREATE DATABASE IF NOT EXISTS carefinder CHARACTER SET utf8mb4;
USE carefinder;


CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  role ENUM('patient','staff') DEFAULT 'patient',
  hospital_name VARCHAR(150) DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE appointments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  patient_name VARCHAR(100),
  phone VARCHAR(25),
  hospital_ref VARCHAR(40),
  hospital_name VARCHAR(150),
  department VARCHAR(80),
  appt_date DATE,
  appt_time VARCHAR(5),
  reason VARCHAR(300),
  status ENUM('Pending','Confirmed','Completed','Cancelled','Declined') DEFAULT 'Pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE hospitals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  address VARCHAR(255),
  latitude DECIMAL(9,6) NOT NULL,
  longitude DECIMAL(9,6) NOT NULL,
  phone VARCHAR(25),
  hospital_type ENUM('Government','Private') NOT NULL,
  rating DECIMAL(2,1) DEFAULT 0,
  reviews_count INT DEFAULT 0,
  emergency_available TINYINT(1) DEFAULT 1,
  icu_available TINYINT(1) DEFAULT 0,
  ambulance_available TINYINT(1) DEFAULT 0,
  blood_available TINYINT(1) DEFAULT 0,
  total_beds INT DEFAULT 0,
  available_beds INT DEFAULT 0,
  opening_time TIME DEFAULT '00:00:00',
  closing_time TIME DEFAULT '23:59:00',
  image VARCHAR(255)
);

CREATE TABLE specialties (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE
);

CREATE TABLE hospital_specialties (
  id INT AUTO_INCREMENT PRIMARY KEY,
  hospital_id INT NOT NULL,
  specialty_id INT NOT NULL,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id) ON DELETE CASCADE,
  FOREIGN KEY (specialty_id) REFERENCES specialties(id) ON DELETE CASCADE
);

CREATE TABLE accident_types (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  description VARCHAR(255)
);

CREATE TABLE hospital_availability (
  id INT AUTO_INCREMENT PRIMARY KEY,
  hospital_id INT NOT NULL,
  emergency_status ENUM('Available','Limited','Call to Confirm') DEFAULT 'Available',
  available_beds INT DEFAULT 0,
  icu_beds INT DEFAULT 0,
  blood_status ENUM('Available','Limited','Unavailable') DEFAULT 'Available',
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id) ON DELETE CASCADE
);

-- ---------- SAMPLE DATA ----------
INSERT INTO specialties (name) VALUES
 ('Emergency'),('Trauma'),('Orthopedics'),('Cardiology'),('Neurology'),
 ('Neurosurgery'),('Burns'),('Pediatrics'),('Pulmonology');

INSERT INTO accident_types (name, description) VALUES
 ('Road Crash','Vehicle collisions, bike accidents, pedestrian hits.'),
 ('Burn','Fire, hot liquid, chemical or electrical burns.'),
 ('Fall','Falls from height, slips and suspected fractures.'),
 ('Sports Injury','Sprains, fractures and ligament injuries during sport.'),
 ('Cardiac Emergency','Chest pain, suspected heart attack, sudden collapse.'),
 ('Breathing Emergency','Severe breathlessness, choking, asthma attack.'),
 ('Other Emergency','Any other urgent situation.');

INSERT INTO hospitals (id,name,address,latitude,longitude,phone,hospital_type,rating,reviews_count,emergency_available,icu_available,ambulance_available,blood_available,total_beds,available_beds,opening_time,closing_time,image) VALUES
 (1,'AIIMS Hospital','Demo Campus Road, Ameerpet, Hyderabad (sample address)',17.4126,78.4482,'+91 99999 00001','Government',4.5,1820,1,1,1,1,900,34,'00:00:00','23:59:00',''),
 (2,'Apollo Hospitals','Demo Main Road, Jubilee Hills, Hyderabad (sample address)',17.4239,78.4115,'+91 99999 00002','Private',4.6,2410,1,1,1,1,550,21,'00:00:00','23:59:00',''),
 (3,'Government General Hospital','Demo Circle, Central Hyderabad (sample address)',17.3850,78.4867,'+91 99999 00003','Government',4.0,940,1,1,1,1,1100,58,'00:00:00','23:59:00',''),
 (4,'Care Hospitals','Demo Street, Banjara Hills, Hyderabad (sample address)',17.4065,78.4691,'+91 99999 00004','Private',4.4,1275,1,1,1,1,300,12,'00:00:00','23:59:00',''),
 (5,'KIMS Hospital','Demo Avenue, Secunderabad (sample address)',17.4400,78.4983,'+91 99999 00005','Private',4.5,1630,1,1,1,1,450,17,'00:00:00','23:59:00',''),
 (6,'City Burn & Plastic Care Centre','Demo Lane, Charminar Area, Hyderabad (sample address)',17.3616,78.4747,'+91 99999 00006','Private',4.2,380,1,1,1,1,80,6,'00:00:00','23:59:00',''),
 (7,'Sunrise Ortho & Sports Clinic','Demo Plaza, Kukatpally, Hyderabad (sample address)',17.4500,78.3900,'+91 99999 00007','Private',4.3,210,1,0,0,0,60,9,'08:00:00','22:00:00',''),
 (8,'Lifeline Heart Institute','Demo Colony, Dilsukhnagar, Hyderabad (sample address)',17.3950,78.5200,'+91 99999 00008','Private',4.7,760,1,1,1,1,120,8,'00:00:00','23:59:00','');

-- hospital_id -> specialty_id (1 Emergency,2 Trauma,3 Ortho,4 Cardio,5 Neuro,6 Neurosurgery,7 Burns,8 Peds,9 Pulmo)
INSERT INTO hospital_specialties (hospital_id, specialty_id) VALUES
 (1,1),(1,2),(1,3),(1,4),(1,5),(1,6),(1,7),(1,8),(1,9),
 (2,1),(2,2),(2,3),(2,4),(2,5),(2,6),(2,9),
 (3,1),(3,2),(3,3),(3,7),(3,8),(3,9),
 (4,1),(4,3),(4,4),(4,5),(4,9),
 (5,1),(5,2),(5,3),(5,4),(5,5),(5,6),
 (6,1),(6,7),(6,8),
 (7,1),(7,3),
 (8,1),(8,4),(8,5),(8,9);

INSERT INTO hospital_availability (hospital_id, emergency_status, available_beds, icu_beds, blood_status) VALUES
 (1,'Available',34,8,'Available'),
 (2,'Available',21,5,'Available'),
 (3,'Available',58,12,'Limited'),
 (4,'Available',12,3,'Available'),
 (5,'Available',17,6,'Available'),
 (6,'Limited',6,2,'Limited'),
 (7,'Call to Confirm',9,0,'Unavailable'),
 (8,'Available',8,4,'Available');


-- Successful account registration/login audit trail.
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
