"""
CareFinder - Smart Nearby Hospital Finder
app.py = the Flask backend.

What it does:
  1. Serves the HTML pages (templates/)
  2. Gives hospital data as JSON (/api/hospitals, /api/hospital/<id>)
  3. Reads data from MySQL. If MySQL is not running / not set up yet,
     it automatically uses database/sample_hospitals.json so the
     project still works while you are learning.

Run:  python app.py   ->  http://127.0.0.1:5000
"""
import json
import math
import os
import sqlite3
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta

from flask import (Flask, abort, flash, jsonify, redirect, render_template,
                   request, session, url_for)
from werkzeug.security import check_password_hash, generate_password_hash

from config import Config

try:
    import mysql.connector
except ImportError:  # the project still runs on sample data
    mysql = None

app = Flask(__name__)
app.config.from_object(Config)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SAMPLE_FILE = os.path.join(BASE_DIR, "database", "sample_hospitals.json")

DISCLAIMER = ("CareFinder provides hospital discovery and comparison information. "
              "It does not diagnose medical conditions. In a life-threatening "
              "emergency, contact your local emergency services.")

ACCIDENT_TYPES = [
    {"name": "Road Crash", "icon": "🚗", "description": "Vehicle collisions, bike accidents, pedestrian hits."},
    {"name": "Burn", "icon": "🔥", "description": "Fire, hot liquid, chemical or electrical burns."},
    {"name": "Fall", "icon": "🩹", "description": "Falls from height, slips and suspected fractures."},
    {"name": "Sports Injury", "icon": "🏃", "description": "Sprains, fractures and ligament injuries during sport."},
    {"name": "Cardiac Emergency", "icon": "❤️", "description": "Chest pain, suspected heart attack, sudden collapse."},
    {"name": "Breathing Emergency", "icon": "🫁", "description": "Severe breathlessness, choking, asthma attack."},
    {"name": "Other Emergency", "icon": "⚠️", "description": "Any other urgent situation."},
]


# ------------------------------------------------------------------
# Database helpers
# ------------------------------------------------------------------
def get_db():
    if mysql is None:
        raise RuntimeError("mysql-connector-python is not installed")
    return mysql.connector.connect(
        host=app.config["MYSQL_HOST"],
        user=app.config["MYSQL_USER"],
        password=app.config["MYSQL_PASSWORD"],
        database=app.config["MYSQL_DB"],
        port=app.config["MYSQL_PORT"],
        connection_timeout=10,
        ssl_ca=app.config.get("MYSQL_SSL_CA") or None,
        ssl_verify_cert=bool(app.config.get("MYSQL_SSL_CA")),
        ssl_verify_identity=bool(app.config.get("MYSQL_SSL_CA")),
    )


def fmt_time(value):
    """MySQL TIME comes back as timedelta -> convert to 'HH:MM'."""
    if isinstance(value, timedelta):
        secs = int(value.total_seconds())
        return f"{secs // 3600:02d}:{(secs % 3600) // 60:02d}"
    return str(value)[:5]


def load_sample():
    with open(SAMPLE_FILE, encoding="utf-8") as f:
        return json.load(f)


HOSPITAL_SQL = """
    SELECT h.*, a.emergency_status, a.available_beds AS live_beds,
           a.icu_beds, a.blood_status
    FROM hospitals h
    LEFT JOIN hospital_availability a ON a.hospital_id = h.id
    ORDER BY h.id
"""
SPECIALTY_SQL = """
    SELECT hs.hospital_id, s.name
    FROM hospital_specialties hs
    JOIN specialties s ON s.id = hs.specialty_id
"""


def normalize_row(r, specialties):
    """Turn one MySQL row into the JSON shape the JavaScript expects."""
    opening, closing = fmt_time(r["opening_time"]), fmt_time(r["closing_time"])
    return {
        "id": r["id"],
        "name": r["name"],
        "address": r["address"],
        "latitude": float(r["latitude"]),
        "longitude": float(r["longitude"]),
        "phone": r["phone"],
        "hospital_type": r["hospital_type"],
        "rating": float(r["rating"]),
        "reviews_count": r.get("reviews_count") or 0,
        "emergency_available": bool(r["emergency_available"]),
        "is_247": opening == "00:00" and closing in ("23:59", "24:00"),
        "icu_available": bool(r["icu_available"]),
        "ambulance_available": bool(r["ambulance_available"]),
        "blood_available": bool(r["blood_available"]),
        "total_beds": r["total_beds"],
        "available_beds": r["live_beds"] if r["live_beds"] is not None else r["available_beds"],
        "icu_beds": r["icu_beds"] or 0,
        "blood_status": r["blood_status"] or ("Available" if r["blood_available"] else "Unavailable"),
        "emergency_status": r["emergency_status"] or "Available",
        "opening_time": opening,
        "closing_time": closing,
        "image": r["image"] or "",
        "specialties": specialties,
    }


def fetch_hospitals():
    """Returns (list_of_hospitals, source) where source is 'mysql' or 'sample'."""
    try:
        conn = get_db()
        cur = conn.cursor(dictionary=True)
        cur.execute(HOSPITAL_SQL)
        rows = cur.fetchall()
        cur.execute(SPECIALTY_SQL)
        spec_rows = cur.fetchall()
        cur.close()
        conn.close()
        if not rows:
            raise RuntimeError("hospitals table is empty")
    except Exception as err:
        app.logger.warning("MySQL not available (%s) - using sample data.", err)
        return load_sample(), "sample"

    specs = {}
    for s in spec_rows:
        specs.setdefault(s["hospital_id"], []).append(s["name"])
    return [normalize_row(r, specs.get(r["id"], [])) for r in rows], "mysql"


@app.context_processor
def inject_globals():
    return {"accidents": ACCIDENT_TYPES, "disclaimer": DISCLAIMER,
            "role": session.get("role", "patient") if session.get("user_id") else "guest"}


# ------------------------------------------------------------------
# Page routes
# ------------------------------------------------------------------
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/accidents")
def accidents():
    return render_template("accident.html")


@app.route("/hospitals")
def hospitals():
    return render_template("hospitals.html")


@app.route("/hospital/<int:hospital_id>")
def hospital_details(hospital_id):
    items, _ = fetch_hospitals()
    hospital = next((h for h in items if h["id"] == hospital_id), None)
    if hospital is None:
        abort(404)
    return render_template("hospital_details.html", hospital_id=hospital_id,
                           hospital_name=hospital["name"])


@app.route("/place")
def place_details():
    """Details page for a live (OpenStreetMap) hospital. JavaScript reads ?ref=..."""
    return render_template("hospital_details.html", hospital_id="",
                           hospital_name="Hospital details")


@app.route("/search")
def search():
    """Form target: passes location/accident to the hospitals page."""
    args = {k: v for k, v in request.args.items() if v}
    return redirect(url_for("hospitals", **args))


# ------------------------------------------------------------------
# JSON API routes
# ------------------------------------------------------------------
@app.route("/api/hospitals")
def api_hospitals():
    items, source = fetch_hospitals()
    return jsonify({"source": source, "count": len(items), "hospitals": items})


@app.route("/api/hospital/<int:hospital_id>")
def api_hospital(hospital_id):
    items, source = fetch_hospitals()
    hospital = next((h for h in items if h["id"] == hospital_id), None)
    if hospital is None:
        return jsonify({"error": "Hospital not found"}), 404
    return jsonify({"source": source, "hospital": hospital})




# Small offline directory used only when the live map-data service is unavailable.
# Names/addresses are sourced from official hospital pages or AP government listings.
# Coordinates below are city-centre fallback coordinates, NOT exact hospital pins.
CITY_CENTRES = {
    "Rajamahendravaram": (17.0005, 81.8040),
    "Kakinada": (16.9891, 82.2475),
    "Samalkota": (17.0537, 82.1696),
    "Pithapuram": (17.1166, 82.2548),
    "Amalapuram": (16.5780, 82.0060),
    "Visakhapatnam": (17.6868, 83.2185),
    "Hyderabad": (17.3850, 78.4867),
}

# Offline directory entries guarantee that the requested towns still show
# hospital choices when OpenStreetMap/Overpass is unavailable or incomplete.
# Coordinates are town/city-centre search pins, NOT verified hospital entrances.
CITY_DIRECTORY = [
    {"id":"dir-rjy-1", "name":"Government General Hospital, Rajamahendravaram", "city":"Rajamahendravaram", "address":"Rajamahendravaram, Andhra Pradesh 533105", "latitude":17.0005, "longitude":81.8040, "phone":"", "hospital_type":"Government", "specialties":[], "source_note":"AP Government hospital listing; approximate city-centre map pin"},
    {"id":"dir-rjy-2", "name":"GSL Medical College & General Hospital", "city":"Rajamahendravaram", "address":"NH-16, Lakshmipuram, Rajamahendravaram, Andhra Pradesh 533296", "latitude":17.0005, "longitude":81.8040, "phone":"+918836699999", "hospital_type":"Private", "specialties":["Emergency Medicine","Orthopedics","Cardiology"], "source_note":"Hospital listing; approximate city-centre map pin"},
    {"id":"dir-kkd-1", "name":"Apollo Hospitals, Kakinada", "city":"Kakinada", "address":"Suryaraopeta Main Road, Kakinada, Andhra Pradesh 533001", "latitude":16.9891, "longitude":82.2475, "phone":"", "hospital_type":"Private", "specialties":[], "source_note":"Hospital listing; approximate city-centre map pin"},
    {"id":"dir-kkd-2", "name":"Medicover Hospitals, Kakinada", "city":"Kakinada", "address":"ADB Road, Panasapadu, Kakinada, Andhra Pradesh 533005", "latitude":16.9891, "longitude":82.2475, "phone":"", "hospital_type":"Private", "specialties":["Cardiology","Orthopedics"], "source_note":"Hospital listing; approximate city-centre map pin"},
    {"id":"dir-sam-1", "name":"Vision Multi Speciality Hospital, Samalkota", "city":"Samalkota", "address":"D. No. 11-1, 29/2, Main Road, near Meher Complex, Samarlakota, Andhra Pradesh 533440", "latitude":17.0537, "longitude":82.1696, "phone":"+919491766405", "hospital_type":"Private", "specialties":["Emergency Medicine","Orthopedics"], "source_note":"Vision Hospitals official listing; approximate town-centre map pin"},
    {"id":"dir-sam-2", "name":"Community Health Centre, Samalkot", "city":"Samalkota", "address":"Samalkot, Kakinada District, Andhra Pradesh", "latitude":17.0537, "longitude":82.1696, "phone":"+918125288989", "hospital_type":"Government", "specialties":[], "source_note":"Andhra Pradesh Government health listing; approximate town-centre map pin"},
    {"id":"dir-pit-1", "name":"Vision Multi Speciality Hospital, Pithapuram", "city":"Pithapuram", "address":"Beside Union Bank of India, near Kotagummam Centre, Kalyanamandapam, Pithapuram, Andhra Pradesh 533450", "latitude":17.1166, "longitude":82.2548, "phone":"+918179120555", "hospital_type":"Private", "specialties":["Emergency Medicine","Orthopedics"], "source_note":"Vision Hospitals official listing; approximate town-centre map pin"},
    {"id":"dir-pit-2", "name":"Community Health Centre, Pithapuram", "city":"Pithapuram", "address":"Pithapuram, Kakinada District, Andhra Pradesh", "latitude":17.1166, "longitude":82.2548, "phone":"", "hospital_type":"Government", "specialties":[], "source_note":"Andhra Pradesh Government health listing; approximate town-centre map pin"},
    {"id":"dir-ama-1", "name":"KIMS Hospital, Amalapuram", "city":"Amalapuram", "address":"NH216, Chaitanya Nagar, Amalapuram, Andhra Pradesh 533201", "latitude":16.5780, "longitude":82.0060, "phone":"+918856239999", "hospital_type":"Private", "specialties":[], "source_note":"KIMS official hospital listing; approximate town-centre map pin"},
    {"id":"dir-ama-2", "name":"Area Hospital, Amalapuram", "city":"Amalapuram", "address":"Amalapuram, Konaseema District, Andhra Pradesh 533201", "latitude":16.5780, "longitude":82.0060, "phone":"", "hospital_type":"Government", "specialties":[], "source_note":"Andhra Pradesh Government hospital listing; approximate town-centre map pin"},
    {"id":"dir-viz-1", "name":"King George Hospital, Visakhapatnam", "city":"Visakhapatnam", "address":"Maharanipeta, Visakhapatnam, Andhra Pradesh 530002", "latitude":17.6868, "longitude":83.2185, "phone":"", "hospital_type":"Government", "specialties":[], "source_note":"Visakhapatnam District Government listing; approximate city-centre map pin"},
    {"id":"dir-viz-2", "name":"Apollo Hospitals, Visakhapatnam", "city":"Visakhapatnam", "address":"Waltair Main Road, Ram Nagar, Visakhapatnam, Andhra Pradesh 530002", "latitude":17.6868, "longitude":83.2185, "phone":"+918912727272", "hospital_type":"Private", "specialties":[], "source_note":"Visakhapatnam District Government listing; approximate city-centre map pin"},
    {"id":"dir-hyd-1", "name":"NIMS Hospital, Hyderabad", "city":"Hyderabad", "address":"Punjagutta, Hyderabad, Telangana", "latitude":17.3850, "longitude":78.4867, "phone":"+914023489999", "hospital_type":"Government", "specialties":[], "source_note":"Telangana Government hospital listing; approximate city-centre map pin"},
    {"id":"dir-hyd-2", "name":"Apollo Hospitals, Jubilee Hills, Hyderabad", "city":"Hyderabad", "address":"Film Nagar, Jubilee Hills, Hyderabad, Telangana", "latitude":17.3850, "longitude":78.4867, "phone":"+914069071200", "hospital_type":"Private", "specialties":[], "source_note":"Apollo official hospital listing; approximate city-centre map pin"},
]

CITY_ALIASES = {
    "samalkot":"Samalkota", "samalkota":"Samalkota", "samarlakota":"Samalkota",
    "pitapuram":"Pithapuram", "pithapuram":"Pithapuram",
    "vizag":"Visakhapatnam", "visakhapatnam":"Visakhapatnam",
    "hyderabad":"Hyderabad", "amalapuram":"Amalapuram",
    "rjy":"Rajamahendravaram", "rajahmundry":"Rajamahendravaram", "rajamahendravaram":"Rajamahendravaram",
    "kkd":"Kakinada", "kakinada":"Kakinada",
}

def canonical_city(value):
    key = (value or "").casefold().strip()
    key = key.replace(", andhra pradesh", "").replace(", telangana", "").strip()
    return CITY_ALIASES.get(key, value.strip() if value else "")

def directory_entries_for_city(city_name):
    city = canonical_city(city_name)
    return [item for item in CITY_DIRECTORY if item["city"].casefold() == city.casefold()]

def directory_hospital_payload(item):
    return {
        "id": item["id"], "live": True, "directory": True,
        "approximate_location": True, "name": item["name"],
        "address": item["address"], "latitude": item["latitude"],
        "longitude": item["longitude"], "phone": item["phone"],
        "hospital_type": item["hospital_type"], "rating": None,
        "reviews_count": 0, "emergency_available": None,
        "emergency_status": "Call to Confirm", "is_247": False,
        "icu_available": None, "ambulance_available": None,
        "blood_available": None, "total_beds": None, "available_beds": None,
        "icu_beds": None, "blood_status": "Unknown", "opening_time": "",
        "closing_time": "", "image": "", "specialties": item["specialties"],
        "source_note": item["source_note"]
    }

def city_directory_fallback(lat, lng):
    """Return local directory entries for a supported city when live data is sparse."""
    nearest_city = min(CITY_CENTRES, key=lambda name: distance_km(lat, lng, *CITY_CENTRES[name]))
    if distance_km(lat, lng, *CITY_CENTRES[nearest_city]) > 35:
        return []
    return [directory_hospital_payload(item) for item in directory_entries_for_city(nearest_city)]


# ------------------------------------------------------------------
# LIVE hospitals for ANY location (OpenStreetMap + Overpass API)
# Free, no API key. Works for every city in the world.
# OpenStreetMap does NOT contain ratings, free beds or blood stock, so those
# fields are sent as null and the website shows "N/A / call to confirm".
# ------------------------------------------------------------------
OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.nchc.org.tw/api/interpreter",
]
CACHE_SECONDS = 21600  # Successful city results stay fresh for 6 hours
_nearby_cache = {}   # {(lat, lng): (time, payload)}; retains stale results as outage fallback

SPECIALTY_MAP = {
    "emergency": "Emergency", "trauma": "Trauma", "orthopaedics": "Orthopedics",
    "orthopedics": "Orthopedics", "cardiology": "Cardiology", "neurology": "Neurology",
    "neurosurgery": "Neurosurgery", "burns": "Burns", "burn": "Burns",
    "paediatrics": "Pediatrics", "pediatrics": "Pediatrics", "pulmonology": "Pulmonology",
    "respiratory": "Pulmonology",
}


def distance_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def osm_to_hospital(el):
    """Turn one OpenStreetMap element into the same JSON shape our JavaScript uses."""
    tags = el.get("tags", {})
    name = tags.get("name:en") or tags.get("name")
    if not name:
        return None
    if el.get("type") == "node":
        lat, lon = el.get("lat"), el.get("lon")
    else:
        center = el.get("center") or {}
        lat, lon = center.get("lat"), center.get("lon")
    if lat is None or lon is None:
        return None

    emergency_tag = tags.get("emergency")
    opening = tags.get("opening_hours", "")
    owner = (tags.get("operator:type") or tags.get("ownership") or "").lower()
    if owner in ("public", "government", "state", "municipal"):
        h_type = "Government"
    elif owner in ("private", "private_non_profit", "community", "religious", "charity"):
        h_type = "Private"
    else:
        h_type = "Unknown"

    specs = []
    for raw in tags.get("healthcare:speciality", "").split(";"):
        key = raw.strip().lower()
        if not key:
            continue
        label = SPECIALTY_MAP.get(key, key.replace("_", " ").title())
        if label not in specs:
            specs.append(label)
    if emergency_tag == "yes" and "Emergency" not in specs:
        specs.insert(0, "Emergency")

    parts = [tags.get("addr:housename"), tags.get("addr:housenumber"), tags.get("addr:street"),
             tags.get("addr:suburb"), tags.get("addr:city")]
    address = tags.get("addr:full") or ", ".join(p for p in parts if p) or "Address not listed - see map"
    phone = (tags.get("phone") or tags.get("contact:phone") or "").split(";")[0].strip()
    try:
        total_beds = int(tags["beds"]) if "beds" in tags else None
    except ValueError:
        total_beds = None

    if tags.get("amenity") == "clinic":
        name = f"{name} (Clinic)"
    image = tags.get("image", "")
    if not image.startswith("http"):
        image = ""
        commons = tags.get("wikimedia_commons", "")
        if commons.startswith("File:"):
            image = ("https://commons.wikimedia.org/wiki/Special:FilePath/"
                     + urllib.parse.quote(commons[5:]) + "?width=600")
    return {
        "id": f"{el['type'][0]}{el['id']}", "live": True,
        "name": name, "address": address, "latitude": lat, "longitude": lon,
        "phone": phone, "hospital_type": h_type,
        "rating": None, "reviews_count": 0,
        "emergency_available": emergency_tag != "no",
        "emergency_status": "Available" if emergency_tag == "yes" else "Call to Confirm",
        "is_247": opening.strip() == "24/7",
        "icu_available": None, "ambulance_available": None, "blood_available": None,
        "total_beds": total_beds, "available_beds": None, "icu_beds": None,
        "blood_status": "Unknown",
        "opening_time": "", "closing_time": "", "image": image, "specialties": specs,
    }


def query_overpass(lat, lng, radius_m, kind="hospital"):
    """Try Overpass mirrors one at a time; parallel duplicate queries trigger rate limits."""
    f = '["amenity"="hospital"]' if kind == "hospital" else '["amenity"="clinic"]'
    query = f'''[out:json][timeout:20];
(
  node{f}(around:{radius_m},{lat},{lng});
  way{f}(around:{radius_m},{lat},{lng});
  relation{f}(around:{radius_m},{lat},{lng});
);
out center tags;'''
    body = urllib.parse.urlencode({"data": query}).encode()
    errors = []
    for url in OVERPASS_URLS:
        try:
            req = urllib.request.Request(url, data=body, headers={
                "User-Agent": "CareFinder-HospitalFinder/1.2 (educational project)",
                "Accept": "application/json",
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            })
            with urllib.request.urlopen(req, timeout=13) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            if not isinstance(payload.get("elements"), list):
                raise ValueError("Unexpected response from map data service")
            return payload["elements"]
        except Exception as err:
            errors.append(f"{url}: {err}")
    raise RuntimeError("Hospital map data is temporarily unavailable. Please retry shortly.")


@app.route("/api/nearby")
def api_nearby():
    """/api/nearby?lat=17.38&lng=78.48  ->  real hospitals around that point."""
    try:
        lat, lng = float(request.args["lat"]), float(request.args["lng"])
    except (KeyError, ValueError):
        return jsonify({"error": "lat and lng are required numbers"}), 400
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return jsonify({"error": "lat/lng out of range"}), 400

    key = (round(lat, 2), round(lng, 2))
    hit = _nearby_cache.get(key)
    if hit and time.time() - hit[0] < CACHE_SECONDS:
        return jsonify({**hit[1], "cached": True})

    MAX_RESULTS = 30
    radius = 40000
    items = []
    try:
        # Search hospitals and clinics over a 40 km local area. For Samalkota,
        # include the nearby Kakinada urban centre so sparse OSM coverage does
        # not produce an empty result list.
        search_centres = [(lat, lng, radius)]
        if distance_km(lat, lng, 17.0537, 82.1696) <= 12:
            search_centres.append((16.9891, 82.2475, 30000))
        elements = []
        for search_lat, search_lng, search_radius in search_centres:
            elements.extend(query_overpass(search_lat, search_lng, search_radius, kind="hospital"))
            elements.extend(query_overpass(search_lat, search_lng, search_radius, kind="clinic"))
        unique = {}
        for element in elements:
            hospital = osm_to_hospital(element)
            if hospital:
                unique[hospital["id"]] = hospital
        items = list(unique.values())
    except Exception as err:
        # If this exact city was searched successfully before, show its last
        # known OSM result instead of a blank error page during an API outage.
        if hit and hit[1].get("hospitals"):
            return jsonify({**hit[1], "cached": True, "stale": True,
                            "notice": "Showing previously loaded hospital data; live refresh is temporarily unavailable."})
        app.logger.warning("Nearby hospital lookup failed: %s", err)
        fallback_items = city_directory_fallback(lat, lng)
        if fallback_items:
            fallback_items.sort(key=lambda h: h["name"].casefold())
            payload = {
                "source": "directory", "count": len(fallback_items),
                "radius_km": radius // 1000, "hospitals": fallback_items,
                "cached": False,
                "notice": "Live map data is temporarily unavailable. Showing a local hospital directory. Exact pins, distance, ratings and current availability are not verified."
            }
            _nearby_cache[key] = (time.time(), payload)
            return jsonify(payload)

        return jsonify({"error": "Live hospital data is unavailable and no local directory is available for this area. Please try a nearby supported city."}), 503

    # Always merge the local directory for supported cities. This guarantees
    # the same registered hospitals appear in patient search and staff registration,
    # even when OSM already returned other hospitals for the city.
    for fallback in city_directory_fallback(lat, lng):
        if not any(str(h.get("name", "")).casefold() == fallback["name"].casefold() for h in items):
            items.append(fallback)
    items.sort(key=lambda h: distance_km(lat, lng, h["latitude"], h["longitude"]))
    items = items[:MAX_RESULTS]
    source = "directory" if items and all(h.get("directory") for h in items) else ("osm+directory" if any(h.get("directory") for h in items) else "osm")
    notice = "Some results use approximate city-centre pins. Confirm the exact hospital address and services by phone." if any(h.get("directory") for h in items) else ""
    payload = {"source": source, "count": len(items), "radius_km": radius // 1000, "hospitals": items, "cached": False, "notice": notice}
    _nearby_cache[key] = (time.time(), payload)
    return jsonify(payload)


# ------------------------------------------------------------------
# Login / register (needs MySQL, optional for the main project)
# ------------------------------------------------------------------
# ------------------------------------------------------------------
# Accounts + appointments storage.
# Local development may use SQLite. When MYSQL_HOST is configured (Render),
# MySQL is mandatory: connection errors are shown instead of silently saving
# visitor data to an isolated local SQLite file.
# ------------------------------------------------------------------
USERS_DB = os.environ.get("CAREFINDER_DB", os.path.join(BASE_DIR, "database", "users.db"))
SLOTS = [f"{h:02d}:{m:02d}" for h in range(9, 18) for m in (0, 30)]
STATUS_CLASS = {"Pending": "orange", "Confirmed": "green", "Completed": "blue",
                "Cancelled": "gray", "Declined": "red"}


def _sqlite():
    conn = sqlite3.connect(USERS_DB)
    conn.row_factory = sqlite3.Row
    conn.execute("""CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT UNIQUE,
        password TEXT, phone TEXT, role TEXT DEFAULT 'patient', hospital_name TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)""")
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(users)")}   # upgrade older files
    if "role" not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'patient'")
    if "hospital_name" not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN hospital_name TEXT DEFAULT ''")
    conn.execute("""CREATE TABLE IF NOT EXISTS appointments (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, patient_name TEXT, phone TEXT,
        hospital_ref TEXT, hospital_name TEXT, department TEXT, appt_date TEXT, appt_time TEXT,
        reason TEXT, status TEXT DEFAULT 'Pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)""")
    return conn


def db(sql, params=(), fetch=None, write=False, only_sqlite=False):
    """Run SQL. Hosted deployments never fall back to per-instance SQLite."""
    hosted_mysql = bool(os.environ.get("MYSQL_HOST"))
    if hosted_mysql or not only_sqlite:
        try:
            conn = get_db()
            cur = conn.cursor(dictionary=True)
            cur.execute(sql.replace("?", "%s"), params)
            if write:
                conn.commit()
                out = cur.lastrowid
            elif fetch == "one":
                out = cur.fetchone()
            else:
                out = cur.fetchall()
            cur.close()
            conn.close()
            return out
        except Exception:
            if hosted_mysql:
                raise
            if not only_sqlite:
                # Local development fallback only.
                pass
            else:
                raise
    conn = _sqlite()
    try:
        cur = conn.execute(sql, params)
        if write:
            conn.commit()
            return cur.lastrowid
        if fetch == "one":
            row = cur.fetchone()
            return dict(row) if row else None
        return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


def find_user(email):
    return db("SELECT * FROM users WHERE email=?", (email,), fetch="one")


def create_user(name, email, pw_hash, phone, role="patient", hospital_name=""):
    db("INSERT INTO users (name, email, password, phone, role, hospital_name) VALUES (?,?,?,?,?,?)",
       (name, email, pw_hash, phone, role, hospital_name), write=True)


def record_login_event(user, event_type="login"):
    """Record successful registration/login events in the shared MySQL database."""
    forwarded_for = request.headers.get("X-Forwarded-For", "")
    ip_address = (forwarded_for.split(",")[0].strip() if forwarded_for
                  else request.remote_addr or "")
    user_agent = request.headers.get("User-Agent", "")[:255]
    db("""INSERT INTO login_history (user_id, email, event_type, ip_address, user_agent)
         VALUES (?,?,?,?,?)""",
       (user["id"], user["email"], event_type, ip_address[:45], user_agent), write=True)


def _norm(text):
    return "".join(ch for ch in (text or "").lower() if ch.isalnum())


def same_hospital(a, b):
    a, b = _norm(a), _norm(b)
    return len(a) >= 4 and len(b) >= 4 and (a == b or a in b or b in a)


def _login_user(user):
    session.clear()
    session["user_id"] = user["id"]
    session["user_name"] = user["name"]
    session["role"] = user.get("role") or "patient"
    session["hospital"] = user.get("hospital_name") or ""


def _safe_next(url):
    url = url or ""
    return url if url.startswith("/") and not url.startswith("//") and "\\" not in url else ""


def render_login(role="patient", tab="login"):
    # Keep the input free-text (the datalist is only a convenience). These names
    # make local RJY/KKD hospitals available in the hospital-staff registration list.
    names = [h["name"] for h in load_sample()]
    names.extend([
        "Government General Hospital, Rajamahendravaram",
        "GSL General Hospital, Rajamahendravaram",
        "Apollo Hospitals, Rajamahendravaram",
        "KIMS Hospitals, Rajamahendravaram",
        "Government General Hospital, Kakinada",
        "Apollo Hospitals, Kakinada",
        "KIMS Hospitals, Kakinada",
        "Medicover Hospitals, Kakinada",
    ])
    names = list(dict.fromkeys(names))
    return render_template("login.html", role=role, tab=tab, hospital_names=names,
                           next_url=_safe_next(request.values.get("next")))


_staff_hospital_cache = {}


# Reliable town-centre fallbacks for common East Godavari spelling variants.
# These are search centres only, NOT exact hospital pins.
CITY_SEARCH_CENTRES = {
    "samalkot": (17.0537, 82.1696, "Samalkota"),
    "samalkota": (17.0537, 82.1696, "Samalkota"),
    "samalkota, andhra pradesh": (17.0537, 82.1696, "Samalkota"),
    "samalkot, andhra pradesh": (17.0537, 82.1696, "Samalkota"),
    "hyderabad": (17.3850, 78.4867, "Hyderabad"),
    "visakhapatnam": (17.6868, 83.2185, "Visakhapatnam"),
    "vizag": (17.6868, 83.2185, "Visakhapatnam"),
    "pithapuram": (17.1166, 82.2548, "Pithapuram"),
    "pitapuram": (17.1166, 82.2548, "Pithapuram"),
    "amalapuram": (16.5780, 82.0060, "Amalapuram"),
}


def geocode_city(city_name):
    """Resolve a user-entered city/town, accepting common spelling variants."""
    key = city_name.casefold().strip()
    direct = CITY_SEARCH_CENTRES.get(key)
    if direct:
        return direct
    canonical = canonical_city(city_name)
    if canonical in CITY_CENTRES:
        lat, lng = CITY_CENTRES[canonical]
        return lat, lng, canonical

    # Try the user's spelling first, then an India/AP-qualified version.
    searches = [city_name, f"{city_name}, Andhra Pradesh, India"]
    for search_text in searches:
        query = urllib.parse.urlencode({"q": search_text, "format": "jsonv2", "limit": 5,
                                        "addressdetails": 1, "countrycodes": "in"})
        url = "https://nominatim.openstreetmap.org/search?" + query
        req = urllib.request.Request(url, headers={
            "User-Agent": "CareFinder-Educational-HospitalFinder/1.4 (educational city search)"
        })
        with urllib.request.urlopen(req, timeout=12) as response:
            data = json.loads(response.read().decode("utf-8"))
        if data:
            # Prefer a populated place rather than a similarly named road/POI.
            result = next((r for r in data if r.get("type") in
                           ("city", "town", "village", "municipality", "administrative")), data[0])
            address = result.get("address", {})
            label = (address.get("city") or address.get("town") or address.get("village")
                     or address.get("municipality") or address.get("county") or city_name)
            return float(result["lat"]), float(result["lon"]), label
    return None


@app.route("/api/staff-hospitals")
def api_staff_hospitals():
    """Return hospitals in any searched Indian city, not only RJY/KKD."""
    city_query = request.args.get("city", "").strip()
    if city_query:
        cache_key = city_query.casefold()
        cached = _staff_hospital_cache.get(cache_key)
        if cached and time.time() - cached[0] < CACHE_SECONDS:
            return jsonify({"hospitals": cached[1], "cached": True, "city": city_query})
        try:
            place = geocode_city(city_query)
            if not place:
                city_key = canonical_city(city_query)
                entries = directory_entries_for_city(city_key)
                if entries:
                    results = [{"name": x["name"], "city": x["city"], "latitude": x["latitude"], "longitude": x["longitude"], "source": "Local directory", "approximate_location": True} for x in entries]
                    _staff_hospital_cache[cache_key] = (time.time(), results)
                    return jsonify({"hospitals": results, "cached": False, "city": city_key, "notice": "Directory results use approximate city-centre map pins. Confirm exact location before registering."})
                return jsonify({"hospitals": [], "error": "City not found. Try another city or district name."}), 404
            lat, lng, city_label = place
            # Search a wider local area and include clinics/health centres too.
            # Samalkota is close to Kakinada, so also query the Kakinada urban
            # centre; this helps when OSM has sparse tags around the town centre.
            search_centres = [(lat, lng, 40000)]
            if city_label.casefold() in ("samalkota", "samalkot") or city_query.casefold().strip() in ("samalkota", "samalkot"):
                search_centres.append((16.9891, 82.2475, 30000))
            elements = []
            for search_lat, search_lng, radius in search_centres:
                elements.extend(query_overpass(search_lat, search_lng, radius, kind="hospital"))
                elements.extend(query_overpass(search_lat, search_lng, radius, kind="clinic"))
            hospitals, seen = [], set()
            for element in elements:
                hospital = osm_to_hospital(element)
                if not hospital:
                    continue
                key = hospital["name"].casefold()
                if key in seen:
                    continue
                seen.add(key)
                hospitals.append({
                    "name": hospital["name"], "city": city_label,
                    "latitude": hospital["latitude"], "longitude": hospital["longitude"],
                    "source": "OpenStreetMap"
                })
            # Add the curated local directory as a minimum-two fallback for the five requested cities.
            city_key = canonical_city(city_label or city_query)
            for entry in directory_entries_for_city(city_key):
                if not any(h["name"].casefold() == entry["name"].casefold() for h in hospitals):
                    hospitals.append({"name": entry["name"], "city": entry["city"],
                                      "latitude": entry["latitude"], "longitude": entry["longitude"],
                                      "source": "Local directory", "approximate_location": True})
            hospitals.sort(key=lambda h: distance_km(lat, lng, h["latitude"], h["longitude"]))
            _staff_hospital_cache[cache_key] = (time.time(), hospitals)
            return jsonify({"hospitals": hospitals, "cached": False, "city": city_key or city_label,
                            "notice": "OpenStreetMap and local directory results are shown. Directory pins are approximate city-centre locations; confirm the exact address before registering."})
        except Exception as err:
            app.logger.warning("Staff hospital city search failed for %s: %s", city_query, err)
            city_key = canonical_city(city_query)
            entries = directory_entries_for_city(city_key)
            if entries:
                hospitals = [{"name": x["name"], "city": x["city"], "latitude": x["latitude"], "longitude": x["longitude"], "source": "Local directory", "approximate_location": True} for x in entries]
                _staff_hospital_cache[cache_key] = (time.time(), hospitals)
                return jsonify({"hospitals": hospitals, "cached": False, "city": city_key,
                                "notice": "Live map data is unavailable. Local directory results use approximate city-centre pins."})
            return jsonify({"hospitals": [], "error": "Live OpenStreetMap search is temporarily unavailable. Please retry."}), 503

    # Initial choices retained for convenience; search any other city above.
    results, seen = [], set()
    for item in CITY_DIRECTORY:
        results.append({"name": item["name"], "city": item["city"],
                        "latitude": item["latitude"], "longitude": item["longitude"],
                        "source": "directory"})
        seen.add(item["name"].casefold())
    for city in [{"city": "Rajamahendravaram", "lat": 17.0005, "lng": 81.8040},
                 {"city": "Kakinada", "lat": 16.9891, "lng": 82.2475}]:
        try:
            for element in query_overpass(city["lat"], city["lng"], 25000, kind="hospital"):
                hospital = osm_to_hospital(element)
                if not hospital or hospital["name"].casefold() in seen:
                    continue
                seen.add(hospital["name"].casefold())
                results.append({"name": hospital["name"], "city": city["city"],
                                "latitude": hospital["latitude"], "longitude": hospital["longitude"],
                                "source": "OpenStreetMap"})
        except Exception:
            continue
    return jsonify({"hospitals": results, "cached": False,
                    "notice": "To load hospitals in another city, search that city above."})


@app.before_request
def require_login():
    """The Login page is the first page. Everything else needs login or guest mode."""
    if request.endpoint in (None, "static", "login", "guest", "api_staff_hospitals"):
        return None
    if session.get("user_id") or session.get("guest"):
        return None
    return redirect(url_for("login"))


@app.route("/guest")
def guest():
    session.clear()
    session["guest"] = True
    return redirect(url_for("index"))


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "GET":
        if session.get("user_id"):
            return redirect(url_for("staff_dashboard" if session.get("role") == "staff" else "index"))
        return render_login()

    action = request.form.get("action", "login")
    role = "staff" if request.form.get("role") == "staff" else "patient"
    email = request.form.get("email", "").strip().lower()
    password = request.form.get("password", "")
    try:
        if action == "register":
            name = request.form.get("name", "").strip()
            phone = request.form.get("phone", "").strip()
            hospital = request.form.get("hospital_name", "").strip() if role == "staff" else ""
            if not (name and email and len(password) >= 6):
                flash("Enter name, email and a password of at least 6 characters.", "danger")
            elif role == "staff" and request.form.get("staff_code", "").strip() != app.config["STAFF_CODE"]:
                flash("Invalid hospital staff access code.", "danger")
            elif role == "staff" and not hospital:
                flash("Enter the name of your hospital.", "danger")
            elif find_user(email):
                flash("This email is already registered. Please log in.", "danger")
            else:
                create_user(name, email, generate_password_hash(password), phone, role, hospital)
                new_user = find_user(email)
                _login_user(new_user)
                record_login_event(new_user, "register")
                flash(f"Account created. Welcome, {name}!", "success")
                return redirect(url_for("staff_dashboard" if role == "staff" else "index"))
            return render_login(role, "register")

        user = find_user(email)
        if not (user and check_password_hash(user["password"], password)):
            flash("Invalid email or password.", "danger")
        elif (user.get("role") or "patient") != role:
            flash("This is a hospital staff account. Choose 'Hospital Staff' above." if (user.get("role") == "staff")
                  else "This is a patient account. Choose 'Patient' above.", "warning")
        else:
            _login_user(user)
            record_login_event(user, "login")
            flash(f"Welcome back, {user['name']}!", "success")
            if role == "staff":
                return redirect(url_for("staff_dashboard"))
            return redirect(_safe_next(request.values.get("next")) or url_for("index"))
    except Exception as err:
        app.logger.warning("Login error: %s", err)
        flash("Something went wrong. Please try again.", "warning")
    return render_login(role, "login")


# ------------------------------------------------------------------
# Appointments (patient books -> hospital staff confirms)
# ------------------------------------------------------------------
@app.route("/appointments/book", methods=["POST"])
def book_appointment():
    if session.get("role") != "patient" or not session.get("user_id"):
        flash("Please login as a patient to book an appointment.", "warning")
        return redirect(url_for("login"))
    f = request.form
    name, phone = f.get("patient_name", "").strip(), f.get("phone", "").strip()
    hospital_ref, hospital_name = f.get("hospital_ref", "").strip(), f.get("hospital_name", "").strip()
    dept, slot, reason = f.get("department", "").strip(), f.get("slot", "").strip(), f.get("reason", "").strip()
    try:
        day = datetime.strptime(f.get("appt_date", ""), "%Y-%m-%d").date()
    except ValueError:
        day = None
    today = date.today()
    error = None
    if not (name and hospital_name and dept):
        error = "Please fill in all the fields."
    elif sum(ch.isdigit() for ch in phone) < 7:
        error = "Enter a valid phone number."
    elif day is None or day < today or day > today + timedelta(days=60):
        error = "Choose a date from today up to 60 days ahead."
    elif slot not in SLOTS:
        error = "Choose a time slot."
    if error:
        flash(error, "danger")
        return redirect(request.referrer or url_for("index"))
    db("""INSERT INTO appointments (user_id, patient_name, phone, hospital_ref, hospital_name,
          department, appt_date, appt_time, reason, status) VALUES (?,?,?,?,?,?,?,?,?,?)""",
       (session["user_id"], name, phone, hospital_ref, hospital_name, dept, day.isoformat(),
        slot, reason[:300], "Pending"), write=True)
    flash("Appointment request sent. Status: Pending. The hospital staff will confirm it – please also call the hospital.", "success")
    return redirect(url_for("my_appointments"))


@app.route("/my-appointments")
def my_appointments():
    if session.get("role") != "patient" or not session.get("user_id"):
        flash("Please login as a patient to see your appointments.", "warning")
        return redirect(url_for("login"))
    rows = db("SELECT * FROM appointments WHERE user_id=? ORDER BY appt_date DESC, appt_time DESC",
              (session["user_id"],), fetch="all")
    return render_template("appointments.html", appointments=rows, status_class=STATUS_CLASS)


@app.route("/appointments/<int:appt_id>/cancel", methods=["POST"])
def cancel_appointment(appt_id):
    if session.get("role") != "patient" or not session.get("user_id"):
        return redirect(url_for("login"))
    db("UPDATE appointments SET status='Cancelled' WHERE id=? AND user_id=? AND status IN ('Pending','Confirmed')",
       (appt_id, session["user_id"]), write=True)
    flash("Appointment cancelled.", "info")
    return redirect(url_for("my_appointments"))


def _staff_only():
    if session.get("role") != "staff" or not session.get("user_id"):
        flash("Hospital staff login required.", "warning")
        return redirect(url_for("login"))
    return None


@app.route("/staff")
def staff_dashboard():
    guard = _staff_only()
    if guard:
        return guard
    hospital = session.get("hospital", "")
    rows = [a for a in db("SELECT * FROM appointments ORDER BY appt_date, appt_time", fetch="all")
            if same_hospital(a["hospital_name"], hospital)]
    rows.sort(key=lambda a: (a["status"] != "Pending", str(a["appt_date"]), str(a["appt_time"])))
    counts = {k: sum(1 for a in rows if a["status"] == k) for k in STATUS_CLASS}
    return render_template("staff.html", appointments=rows, counts=counts, hospital=hospital,
                           status_class=STATUS_CLASS)


@app.route("/staff/appointment/<int:appt_id>/<action>", methods=["POST"])
def staff_update(appt_id, action):
    guard = _staff_only()
    if guard:
        return guard
    new_status = {"confirm": "Confirmed", "decline": "Declined", "complete": "Completed"}.get(action)
    appt = db("SELECT * FROM appointments WHERE id=?", (appt_id,), fetch="one")
    if not new_status or not appt or not same_hospital(appt["hospital_name"], session.get("hospital", "")):
        abort(404)
    db("UPDATE appointments SET status=? WHERE id=?", (new_status, appt_id), write=True)
    flash(f"Appointment {new_status.lower()}.", "success")
    return redirect(url_for("staff_dashboard"))


@app.route("/logout")
def logout():
    session.clear()
    flash("You have been logged out.", "info")
    return redirect(url_for("index"))


if __name__ == "__main__":
    app.run(debug=True)
