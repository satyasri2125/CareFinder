# CareFinder – Smart Nearby Hospital Finder

*Find the right nearby hospital faster when every minute matters.*

A beginner-friendly diploma project: **HTML + CSS + JavaScript** frontend, **Python Flask** backend,
**MySQL** database, **Leaflet / OpenStreetMap** map and the browser **Geolocation API**.

> ⚠️ CareFinder provides hospital discovery and comparison information. It does not diagnose medical
> conditions. In a life-threatening emergency, contact your local emergency services.
>
> **Two data sources:**
> 1. For any city/area you type (or your GPS location), hospitals are loaded **live from OpenStreetMap** (`/api/nearby`). These are real places, but OpenStreetMap has no ratings, free beds or blood stock, so those show as *N/A / call to confirm*.
> 2. The built-in **demo location (Hyderabad)** uses sample data (MySQL or `sample_hospitals.json`) with demo beds/ratings/phones.

---

## 1. How to run (3 steps)

```bash
cd carefinder
pip install -r requirements.txt
python app.py
```

Open **http://127.0.0.1:5000**

The project works immediately. Rajamahendravaram and Kakinada searches load live OpenStreetMap hospitals. MySQL/sample data remains available for the demo hospital dataset and login/appointment storage.

## 2. Connect MySQL (optional, do this after the site works)

1. Install MySQL and start it.
2. Import the schema and sample data:
   ```bash
   mysql -u root -p < database/schema.sql
   ```
3. Open `config.py` and set your MySQL password (or set the `MYSQL_PASSWORD` environment variable).
4. Restart `python app.py`. Open `/api/hospitals` – the `"source"` field will say `"mysql"` instead of `"sample"`.

## 3. Folder structure and what each file does

| File | Purpose |
|---|---|
| `app.py` | Flask backend. Page routes (`/`, `/accidents`, `/hospitals`, `/hospital/<id>`, `/place`, `/search`, `/login`) and JSON APIs (`/api/hospitals`, `/api/hospital/<id>`, `/api/nearby?lat=&lng=`). `/api/nearby` asks the free OpenStreetMap Overpass API for real hospitals around any point (cached 6 hours; Overpass mirrors are tried one-by-one to reduce duplicate requests and rate limits; previously loaded results are reused if the live service is temporarily unavailable). Demo data comes from MySQL, falling back to the JSON file. |
| `config.py` | MySQL host, user, password, database name, secret key. |
| `requirements.txt` | Python packages: Flask, mysql-connector-python, Werkzeug. |
| `database/schema.sql` | Creates the 6 tables (users, hospitals, specialties, hospital_specialties, accident_types, hospital_availability) and inserts sample data. |
| `database/sample_hospitals.json` | Same sample data as JSON – used when MySQL is not available. |
| `templates/base.html` | Shared layout: navbar, footer, disclaimer, toast area. |
| `templates/index.html` | **Page 1** Home: hero, search card, features, about, contact. |
| `templates/accident.html` | **Page 2** Accident type cards. |
| `templates/hospitals.html` | **Pages 3, 5, 6, 7** Map + hospital cards, Best Hospital Match, filter sidebar, quick-view card. |
| `templates/hospital_details.html` | **Page 4** Hospital details (filled by JavaScript from `/api/hospital/<id>`). |
| `templates/login.html` | Optional login / register (needs MySQL). |
| `static/css/style.css` | All styling – colours are variables at the top of the file. |
| `static/js/script.js` | All JavaScript: location, ranking, filters, map, cards, toasts. |
| `static/images/` | Put hospital photos here and write the file name in the `image` column. |

## 4. How the ranking works (in `script.js`)

```
Match score (0–100) = Distance (30) + Specialty match (30) + Emergency capability (15)
                    + Availability (10) + Rating & type (15)
```

* **Distance** – Haversine formula (straight-line km), closer = higher score.
* **Specialty match** – each accident type has a weight table (`ACCIDENT_PROFILES`).
  Example: *Road Crash* → Trauma 3, Emergency 3, Orthopedics 2, Neurosurgery 2, Neurology 1.
* **Emergency capability** – emergency dept, 24/7, ICU, ambulance, and current emergency status.
* **Availability** – open now, free beds, blood availability.
* **Rating & type** – rating plus a small tie-breaker for hospital type.

The score is only a way to compare hospitals; it is **not** medical advice. To change the behaviour,
edit `ACCIDENT_PROFILES` and `scoreHospital()` in `script.js`.

## 5. Features checklist

Responsive navbar · search by area · use current location · accident selection · filtering and
sorting · dynamic hospital cards · Leaflet map with markers, popups and quick view · hospital
details page · call and directions buttons · loading animation · empty-result message · error
handling · toast notifications · hover animations · smooth scrolling · mobile layout · 🚨 Emergency mode
(`/hospitals?emergency=1`: nearest 24/7 hospitals, call 112 / ambulance 108 buttons).

## 6. Notes

* Geolocation only works on `localhost` or HTTPS, and the user must allow permission.
* Map tiles and "Search by Area" for places outside the built-in list need an internet connection
  (OpenStreetMap / Nominatim).
* Searching any area loads real hospitals near it from OpenStreetMap (needs internet). If that
  service is unreachable, the app shows a message and falls back to the Hyderabad demo data.
* OpenStreetMap data is community-made: some hospitals have no phone, hours or specialties.
  The match score then relies mostly on distance, and the website says so (N/A / call to confirm).
* Directions open Google Maps in a new tab. Distances are straight-line; times are rough estimates.

## 7. Ideas for future improvement

Live bed availability from hospital dashboards · saved favourite hospitals per user · hospital admin
panel · more languages (Telugu / Hindi) · real routing distance.

## 8. Hospital photos

* Each hospital card shows a **building picture** drawn by `hospitalArt()` in `script.js` (works offline, a little different for every hospital).
* If OpenStreetMap has a photo for a hospital (`image` / `wikimedia_commons` tag), that real photo is shown instead.
* To use your own photos for the demo hospitals: copy the file into `static/images/` (for example `aiims.jpg`) and write the file name in the `image` field of `database/sample_hospitals.json` (or the `image` column in MySQL).

## 9. Login, roles and appointments

* **Login page is the first page.** Choose **Patient** or **Hospital Staff**, then Login / Register (icons on every field, 👁 eye button shows/hides the password). "Continue as Guest" lets you search hospitals without an account.
* **Patient:** open any hospital → *Book Appointment* (name, phone, department, date, time slot) → see/cancel requests in **My Appointments**.
* **Hospital Staff:** register with the **hospital name** and the **staff access code** (default `CARE-STAFF-2026`; change it in `config.py` or set the `STAFF_CODE` environment variable). The **Staff Dashboard** lists appointments booked for that hospital name (Confirm / Decline / Mark completed).
* Accounts and appointments are stored in MySQL when connected (re-run `database/schema.sql` once to create the new `appointments` table and the `role` / `hospital_name` columns), otherwise in `database/users.db` (SQLite, created automatically).
* This is a demo booking system: hospitals outside this app are not notified, so the page always tells the patient to call the hospital.


## Hospital search fallback (updated)
- Live nearby hospitals are requested from OpenStreetMap Overpass first.
- If Overpass is unavailable, Rajamahendravaram and Kakinada searches use the built-in local hospital directory.
- The fallback intentionally labels city-level coordinates as approximate and does not show exact hospital pins or calculated distances.
- Ratings, bed counts, opening hours and live emergency availability are not invented; users are prompted to call and confirm.
- The local directory includes a small set of entries from official hospital pages and the Andhra Pradesh government recognized-hospital list. Check the source pages before relying on details:
  - https://dme.ap.nic.in/leftmenu_pages/ma_menu/ma/Recognizedhosolist.pdf
  - https://www.apollohospitals.com/hospitals/apollo-hospitals-kakinada
  - https://www.medicoverhospitals.in/hospitals/andhra-pradesh/kakinada/
  - https://www.gvshospital.com/
  - https://gslmc.com/contactus.html


## Hospital staff registration map fix
- Staff registration now loads choices from the same `CITY_DIRECTORY` used by the patient-side offline hospital directory, plus OpenStreetMap hospital names.
- The map link updates to the selected hospital's city and passes the selected hospital name to the map page.
- If the exact hospital is present in current map results, CareFinder selects/highlights it. If not, it warns that only nearby hospitals are displayed.
- No MySQL schema change is required for this fix. Restart Flask so the updated Python route and JavaScript are loaded.

## Render + TiDB Cloud (shared database)

For a shared deployment, create the `carefinder` database in TiDB Cloud and run `database/schema.sql` once in its SQL Editor. The schema no longer drops existing tables.

Set these Render environment variables (never put passwords in source code):

- `MYSQL_HOST` — TiDB public endpoint host
- `MYSQL_PORT` — TiDB port (usually `4000`)
- `MYSQL_USER` — TiDB-generated username
- `MYSQL_PASSWORD` — current TiDB password
- `MYSQL_DB` — `carefinder`
- `MYSQL_SSL_CA` — path to the TiDB CA certificate file included in the deployment
- `SECRET_KEY` — a long, random secret
- `STAFF_CODE` — a private staff-registration code

When `MYSQL_HOST` is set, account and appointment operations require the hosted MySQL database and will not silently fall back to local SQLite. Local development without `MYSQL_HOST` can still use SQLite. Keep TLS certificate verification enabled.


## Hosted database notes (TiDB Cloud + Render)
- Configure the Render environment variables `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DB`, `MYSQL_SSL_CA`, and a strong `SECRET_KEY`.
- `MYSQL_SSL_CA` must be the path to the TiDB CA certificate file available in the deployed service. TLS certificate verification is enabled when this path is set. Do not disable certificate verification.
- Run `database/migrations/001_login_history.sql` once in the existing TiDB `carefinder` database to enable successful registration/login event history.
- Registration, successful login events, and appointment bookings are stored in MySQL when `MYSQL_HOST` is configured. Passwords are stored as Werkzeug password hashes, not plaintext.
- Login history records the account email, event type, timestamp, IP address, and browser user-agent. Tell users this information is collected.
- Hospital sample records in `schema.sql` are demo data, not verified live hospital capacity.
