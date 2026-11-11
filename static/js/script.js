/* =====================================================================
   CareFinder - Smart Nearby Hospital Finder
   script.js = all the JavaScript for the website (shared by every page)

   How this file is organised
     1. Small helpers (storage, toast, escaping)
     2. Location (browser GPS + typed area)
     3. Ranking logic  (distance + specialty + emergency + availability + rating)
     4. HTML builders  (hospital cards, quick view, best match)
     5. Page code      (home / accident / hospitals / details / login)
   The <body data-page="..."> attribute tells us which page we are on.
   ===================================================================== */
"use strict";

/* ---------------------------------------------------------------
   1. HELPERS
   --------------------------------------------------------------- */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// sessionStorage keeps the chosen location / accident while you move between pages
const STORE = {
  get(key, fallback = null) {
    try { const v = sessionStorage.getItem("cf_" + key); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  },
  set(key, value) {
    try { sessionStorage.setItem("cf_" + key, JSON.stringify(value)); } catch (e) { /* ignore */ }
  }
};

// Escape text before putting it into HTML (prevents broken markup / injection)
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Toast notification (small message in the bottom-right corner)
function showToast(message, type = "info", ms = 3800) {
  const box = $("#toasts");
  if (!box) return;
  const icons = { success: "✅", error: "⚠️", warn: "ℹ️", info: "💬" };
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.innerHTML = `<span>${icons[type] || "💬"}</span><span>${esc(message)}</span>`;
  box.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .3s"; }, ms);
  setTimeout(() => el.remove(), ms + 350);
}

// Put a button into a "loading" state while something is running
function setBusy(btn, busy, busyText = "Please wait…") {
  if (!btn) return;
  if (busy) { btn.dataset.label = btn.innerHTML; btn.innerHTML = busyText; btn.disabled = true; }
  else { btn.innerHTML = btn.dataset.label || btn.innerHTML; btn.disabled = false; }
}

/* ---------------------------------------------------------------
   2. LOCATION
   --------------------------------------------------------------- */
// Default to Rajamahendravaram so the app does not unexpectedly show only
// the Hyderabad demo hospitals. Users can still search Hyderabad or Kakinada.
const DEFAULT_LOC = { lat: 17.0005, lng: 81.8040, label: "Rajamahendravaram", demo: false };

// A few well known areas so "Search by Area" works even without internet.
// Any other place name is looked up with OpenStreetMap Nominatim.
const AREAS = {
  // --- main cities ---
  "rajahmundry": [17.0005, 81.8040], "rajamahendravaram": [17.0005, 81.8040],
  "rjy": [17.0005, 81.8040], "rajahmundry, andhra pradesh": [17.0005, 81.8040],
  "kakinada": [16.9891, 82.2475], "kkd": [16.9891, 82.2475],
  "kakinada, andhra pradesh": [16.9891, 82.2475],
  "hyderabad": [17.3850, 78.4867], "visakhapatnam": [17.6868, 83.2185], "vijayawada": [16.5062, 80.6480],
  "eluru": [16.7107, 81.0952], "bhimavaram": [16.5449, 81.5212],
  // --- near Kakinada / East Godavari (towns and villages) ---
  "samalkot": [17.0537, 82.1696], "samalkota": [17.0537, 82.1696], "samalkota, andhra pradesh": [17.0537, 82.1696], "peddapuram": [17.0780, 82.1380], "pithapuram": [17.1166, 82.2548],
  "tuni": [17.3570, 82.5480], "annavaram": [17.2830, 82.3900], "sarpavaram": [16.9960, 82.2400],
  "gollaprolu": [17.0830, 82.1830], "yanam": [16.7333, 82.2167], "ramachandrapuram": [16.8300, 82.0300],
  "mandapeta": [16.8667, 81.9333], "draksharamam": [16.7930, 82.0620], "amalapuram": [16.5780, 82.0060],
  "korukonda": [17.0540, 81.9140], "anaparthi": [17.0040, 81.9300], "kovvur": [17.0170, 81.7330],
  "nidadavole": [16.9140, 81.6700], "tanuku": [16.7540, 81.6810], "rampachodavaram": [17.4400, 81.7700],
  // --- Hyderabad areas ---
  "ameerpet": [17.4375, 78.4483], "jubilee hills": [17.4326, 78.4071], "banjara hills": [17.4156, 78.4347],
  "secunderabad": [17.4399, 78.4983], "kukatpally": [17.4948, 78.3996], "charminar": [17.3616, 78.4747],
  "dilsukhnagar": [17.3688, 78.5247], "hitech city": [17.4435, 78.3772], "gachibowli": [17.4401, 78.3489],
  "begumpet": [17.4447, 78.4664], "madhapur": [17.4486, 78.3908], "lb nagar": [17.3457, 78.5522], "kondapur": [17.4721, 78.3569]
};

function titleCase(s) { return s.replace(/\b\w/g, (c) => c.toUpperCase()); }

function fillAreaList() {
  const dl = $("#areaList");
  if (dl) dl.innerHTML = Object.keys(AREAS).map((a) => `<option value="${titleCase(a)}">`).join("");
}

// Ask the browser for the user's GPS position (shows the permission popup)
function getCurrentLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Location is not supported in this browser."));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: "Current location" }),
      (err) => {
        const msg = { 1: "Location permission was denied. Type your area instead.",
                      2: "Could not detect your location. Type your area instead.",
                      3: "Location request timed out. Try again or type your area." };
        reject(new Error(msg[err.code] || "Could not get your location."));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  });
}

// Turn a typed place name into latitude/longitude. Returns null if not found.
async function geocodeArea(text) {
  const key = text.trim().toLowerCase();
  if (!key) return null;
  if (AREAS[key]) return { lat: AREAS[key][0], lng: AREAS[key][1], label: titleCase(key) };
  // Ask OpenStreetMap. If the full text fails (e.g. tiny village), retry without the first word(s).
  const parts = text.split(",").map((x) => x.trim()).filter(Boolean);
  for (let i = 0; i < Math.min(parts.length, 3); i++) {
    const q = parts.slice(i).join(", ");
    try {
      const url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(q);
      const res = await fetch(url, { headers: { Accept: "application/json" }, cache: "force-cache" });
      const data = await res.json();
      if (data.length) {
        return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon),
                 label: (i === 0 ? q : text.trim()).split(",").slice(0, 3).join(",").trim() };
      }
    } catch (e) { /* offline or blocked */ }
  }
  return null;
}

// Straight-line distance between two GPS points in km (Haversine formula)
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/* ---------------------------------------------------------------
   3. RANKING LOGIC
   Match score (0-100) = Distance 30 + Specialty 30 + Emergency 15
                        + Availability 10 + Rating & type 15
   It is only a way to compare hospitals. It is NOT medical advice.
   --------------------------------------------------------------- */
// Which specialties matter most for each accident type (bigger number = more important)
const ACCIDENT_PROFILES = {
  "Road Crash":          { Trauma: 3, Emergency: 3, Orthopedics: 2, Neurosurgery: 2, Neurology: 1 },
  "Burn":                { Burns: 4, Emergency: 3, Trauma: 1, Pediatrics: 0.5 },
  "Fall":                { Orthopedics: 3, Trauma: 3, Emergency: 2, Neurosurgery: 1 },
  "Sports Injury":       { Orthopedics: 4, Emergency: 1.5, Trauma: 1 },
  "Cardiac Emergency":   { Cardiology: 4, Emergency: 3, Neurology: 0.5 },
  "Breathing Emergency": { Pulmonology: 4, Emergency: 3, Cardiology: 1 },
  "Other Emergency":     { Emergency: 3, Trauma: 1 }
};

function isOpenNow(h) {
  if (h.is_247) return true;
  if (!h.opening_time) return false;   // live map data usually has no hours
  const toMin = (t) => { const [hh, mm] = String(t).split(":").map(Number); return hh * 60 + (mm || 0); };
  const now = new Date(), cur = now.getHours() * 60 + now.getMinutes();
  const open = toMin(h.opening_time), close = toMin(h.closing_time);
  return open <= close ? cur >= open && cur <= close : cur >= open || cur <= close; // handles overnight hours
}

function scoreHospital(h, accident) {
  const profile = ACCIDENT_PROFILES[accident] || ACCIDENT_PROFILES["Other Emergency"];
  const totalWeight = Object.values(profile).reduce((a, b) => a + b, 0);
  let got = 0; const matched = [];
  for (const [spec, w] of Object.entries(profile)) {
    if (h.specialties.includes(spec)) { got += w; matched.push(spec); }
  }
  const distance = 30 * Math.exp(-h._km / 10);                   // 0 km = 30, 10 km = 11
  const specialty = 30 * (got / totalWeight);
  let emergency = h.emergency_available ? (h.is_247 ? 9 : 5) : 0;
  emergency += (h.icu_available ? 3 : 0) + (h.ambulance_available ? 3 : 0);
  emergency *= { "Available": 1, "Limited": 0.8, "Call to Confirm": 0.6 }[h.emergency_status] ?? 1;
  const bedsPart = h.available_beds == null ? 1.5 : Math.min(h.available_beds / 20, 1) * 3;   // unknown = neutral
  const availability = (h._open ? 4 : h._hoursUnknown ? 2 : 0) + bedsPart +
                       ({ "Available": 3, "Limited": 1.5, "Unknown": 1 }[h.blood_status] || 0);
  const ratingType = ((h.rating ?? 3.5) / 5) * 13 + (h.hospital_type === "Government" ? 2 : 1.5); // small tie-breaker for type
  const parts = {
    "Distance": [distance, 30], "Specialty match": [specialty, 30], "Emergency capability": [emergency, 15],
    "Availability": [availability, 10], "Rating & type": [ratingType, 15]
  };
  const total = Math.min(100, Math.round(Object.values(parts).reduce((s, p) => s + p[0], 0)));
  return { total, parts, matched };
}

// Add distance, open status and score to a hospital object
function enrich(h, loc, accident) {
  h._km = haversine(loc.lat, loc.lng, h.latitude, h.longitude);
  h._eta = Math.max(2, Math.round((h._km / 30) * 60));          // rough city driving estimate at 30 km/h
  h._open = isOpenNow(h);
  h._hoursUnknown = !!h.live && !h.is_247 && !h.opening_time;
  const s = scoreHospital(h, accident);
  h._score = s.total; h._parts = s.parts; h._matched = s.matched;
  return h;
}

// "Why this hospital?" bullet points (max 5)
function whyList(h, accident) {
  const out = [];
  if (h.approximate_location) out.push("Exact hospital pin and distance are not available; use Get Directions to confirm the location");
  else if (h._km <= 6) out.push(`Close distance – ${h._km.toFixed(1)} km (about ${h._eta} min, estimate)`);
  else out.push(`${h._km.toFixed(1)} km away (about ${h._eta} min, estimate)`);
  if (h.emergency_available && h.emergency_status !== "Call to Confirm") out.push(h.is_247 ? "Emergency department available 24/7" : "Emergency department available");
  else if (h.live) out.push("Emergency service not confirmed – call before going");
  if (h._matched.length) out.push(`${h._matched.slice(0, 3).join(", ")} specialty available for ${accident}`);
  if (h.rating >= 4.3) out.push(`Good rating (${h.rating.toFixed(1)} ⭐)`);
  if (h._open) out.push("Currently open");
  if (h.icu_available && out.length < 5) out.push("ICU available");
  return out.slice(0, 5);
}

function availabilityPill(h) {
  if (h.emergency_available == null) return { cls: "orange", text: "Call to confirm" };
  if (!h.emergency_available) return { cls: "red", text: "No emergency dept" };
  if (h._hoursUnknown) return { cls: "orange", text: "Call to confirm" };
  if (!h._open) return { cls: "gray", text: "Closed now – call to confirm" };
  if (h.emergency_status === "Limited") return { cls: "orange", text: "Limited availability" };
  if (h.emergency_status === "Call to Confirm") return { cls: "orange", text: "Call to confirm" };
  return { cls: "green", text: "Emergency available" };
}

function openPill(h) {
  if (h._open) return { cls: "green", text: "Open now" };
  if (h._hoursUnknown) return { cls: "gray", text: "Hours not listed" };
  return { cls: "gray", text: "Closed" };
}
const ratingText = (h) => (h.rating == null ? "N/A" : h.rating.toFixed(1));
const hospitalLink = (h) => (h.live ? `/place?ref=${encodeURIComponent(h.id)}` : `/hospital/${h.id}`);
function hoursText(h) {
  if (h.is_247) return "24/7";
  if (h.opening_time) return `${h.opening_time}–${h.closing_time}`;
  return "Hours not listed – call to confirm";
}
function bedsText(h) {
  if (h.available_beds != null) return `${h.available_beds} beds available`;
  return h.total_beds ? `${h.total_beds} beds total` : "Beds: not listed";
}
function callButton(h, cls, label) {
  if (h.phone) return `<a class="btn ${cls}" href="${telLink(h)}">📞 ${label}</a>`;
  return `<span class="btn btn-outline btn-sm" style="opacity:.6;cursor:default" title="No phone number in map data">📞 No phone listed</span>`;
}
const telLink = (h) => "tel:" + String(h.phone).replace(/[^\d+]/g, "");
function directionsLink(h, loc) {
  const origin = loc && !loc.demo ? `&origin=${loc.lat},${loc.lng}` : "";
  const destination = h.approximate_location
    ? encodeURIComponent(h.address || h.name)
    : `${h.latitude},${h.longitude}`;
  return `https://www.google.com/maps/dir/?api=1${origin}&destination=${destination}&travelmode=driving`;
}
function distanceLabel(h) {
  return h.approximate_location ? "Exact distance unavailable" : `${h._km.toFixed(1)} km · ~${h._eta} min`;
}

/* ---------------------------------------------------------------
   4. HTML BUILDERS
   --------------------------------------------------------------- */
// Colour sets for the hospital pictures: [sky, wall, accent]
const ART_PALETTES = [["#cdbfff", "#f1ecff", "#6d4aff"], ["#bcd9ff", "#eaf3ff", "#3b82f6"], ["#c6f0e0", "#eefaf5", "#16a34a"],
                      ["#ffd9c2", "#fff3ec", "#ea8a0c"], ["#e0c9ff", "#f6eeff", "#7c3aed"]];

// Draws a hospital building picture (SVG). Every hospital gets a slightly different one.
function hospitalArt(h) {
  const seed = [...String(h.id) + h.name].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const [sky, wall, accent] = ART_PALETTES[seed % 5];
  const style = (seed >> 3) % 3, floors = 3 + ((seed >> 5) % 3), G = 170;
  const block = (x, w, f, door) => {
    const top = G - f * 26;
    let out = `<rect x="${x}" y="${top}" width="${w}" height="${G - top}" fill="${wall}" stroke="${accent}" stroke-opacity=".35"/>` +
              `<rect x="${x}" y="${top}" width="${w}" height="6" fill="${accent}"/>`;
    const cols = Math.max(2, Math.floor((w - 8) / 20)), gap = (w - cols * 12) / (cols + 1);
    for (let r = 0; r < f; r++) for (let c = 0; c < cols; c++) {
      const wx = x + gap * (c + 1) + c * 12;
      if (door && r === f - 1 && Math.abs(wx + 6 - (x + w / 2)) < 14) continue;
      out += `<rect x="${wx.toFixed(1)}" y="${top + 12 + r * 26}" width="12" height="12" rx="2" fill="#bcd6ff"/>`;
    }
    if (door) out += `<rect x="${x + w / 2 - 11}" y="${G - 32}" width="22" height="32" rx="3" fill="${accent}"/>` +
                     `<rect x="${x + w / 2 - 1}" y="${G - 32}" width="2" height="32" fill="#fff" opacity=".6"/>`;
    return out;
  };
  let bld, mainTop, cx = 150;
  if (style === 0) { bld = block(45, 50, 2) + block(205, 50, 2) + block(95, 110, floors, true); mainTop = G - floors * 26; }
  else if (style === 1) { const f = Math.max(2, floors - 1); bld = block(40, 220, f, true); mainTop = G - f * 26; }
  else { bld = block(55, 60, 2) + block(185, 60, 2) + block(115, 70, floors + 1, true); mainTop = G - (floors + 1) * 26; }
  const sign = `<rect x="${cx - 14}" y="${mainTop - 30}" width="28" height="28" rx="6" fill="#e11d48"/>` +
               `<rect x="${cx - 3}" y="${mainTop - 25}" width="6" height="18" rx="1.5" fill="#fff"/>` +
               `<rect x="${cx - 9}" y="${mainTop - 19}" width="18" height="6" rx="1.5" fill="#fff"/>`;
  const ambulance = h.emergency_available ? `<g transform="translate(${50 + ((seed >> 7) % 150)} 177)">
      <rect x="0" y="0" width="38" height="15" rx="3" fill="#fff"/><path d="M38 3h8l5 6v6H38z" fill="#fff"/>
      <rect x="15" y="3" width="3" height="9" fill="#e11d48"/><rect x="12" y="6" width="9" height="3" fill="#e11d48"/>
      <circle cx="10" cy="16" r="3.5" fill="#1f1b3a"/><circle cx="43" cy="16" r="3.5" fill="#1f1b3a"/></g>` : "";
  const sx = 30 + (seed % 200);
  return `<svg viewBox="0 0 300 200" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Illustration of ${esc(h.name)}">
    <defs><linearGradient id="sky${seed}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky}"/><stop offset="1" stop-color="#ffffff"/></linearGradient></defs>
    <rect width="300" height="200" fill="url(#sky${seed})"/>
    <circle cx="${sx}" cy="34" r="15" fill="#fff" opacity=".9"/><ellipse cx="${(sx + 120) % 280 + 10}" cy="46" rx="26" ry="8" fill="#fff" opacity=".7"/>
    <rect x="0" y="${G}" width="300" height="30" fill="#3a3560"/>
    <line x1="0" y1="${G + 22}" x2="300" y2="${G + 22}" stroke="#fff" stroke-width="2" stroke-dasharray="14 10" opacity=".6"/>
    <rect x="12" y="150" width="5" height="20" fill="#7a5a3a"/><circle cx="14.5" cy="145" r="13" fill="#4caf79"/>
    <rect x="283" y="152" width="5" height="18" fill="#7a5a3a"/><circle cx="285.5" cy="147" r="12" fill="#3f9f6b"/>
    ${bld}${sign}${ambulance}</svg>`;
}

function hospitalImage(h) {
  if (!h.image) return `<div class="h-art">${hospitalArt(h)}</div>`;
  const src = /^https?:\/\//.test(h.image) ? h.image : `/static/images/${h.image}`;
  // real photo; if it fails to load, show the building picture instead
  return `<img src="${esc(src)}" alt="${esc(h.name)}" loading="lazy" referrerpolicy="no-referrer"
            onerror="this.style.display='none';this.nextElementSibling.hidden=false">
          <div class="h-art" hidden>${hospitalArt(h)}</div>`;
}

function hospitalCard(h, rank, accident) {
  const pill = availabilityPill(h);
  const specChips = h.specialties.slice(0, 4).map((s) =>
    `<span class="chip ${h._matched.includes(s) ? "match" : ""}">${esc(s)}</span>`).join("");
  return `
  <article class="h-card fade-in" data-id="${h.id}">
    <div class="h-img">${hospitalImage(h)}<span class="rank-tag">#${rank}</span></div>
    <div>
      <div class="h-top"><h3>${esc(h.name)}</h3><span class="rating">⭐ ${ratingText(h)}</span></div>
      <div class="h-meta">
        <span>📍 ${distanceLabel(h)}</span>
        <span>🏥 ${esc(h.hospital_type)}</span>
        <span>🕒 ${esc(hoursText(h))}</span>
      </div>
      <div class="chips">
        <span class="pill ${pill.cls}">🚨 ${pill.text}</span>
        <span class="pill ${openPill(h).cls}">${openPill(h).text}</span>
      </div>
      <div class="chips">${specChips}</div>
      <div class="h-stats">
        <span>🛏 ${esc(bedsText(h))}</span>
        <span>🩸 Blood: ${esc(h.blood_status)}</span>
      </div>
      <div class="match-line"><span>Match ${h._score}%</span><div class="bar"><i style="width:${h._score}%"></i></div></div>
      <div class="h-actions">
        <a class="btn btn-primary btn-sm" href="${hospitalLink(h)}">View Details</a>
        ${callButton(h, "btn-outline btn-sm", "Call Hospital")}
        <a class="btn btn-outline btn-sm" target="_blank" rel="noopener" href="${directionsLink(h, state.loc)}">🧭 Get Directions</a>
      </div>
    </div>
  </article>`;
}

function quickViewHTML(h) {
  const specs = h.specialties.slice(0, 3).map((s) => `<span class="chip">${esc(s)}</span>`).join("");
  return `
    <button class="qv-close" id="qvClose" aria-label="Close">×</button>
    <h3>${esc(h.name)}</h3>
    <div class="qv-row">
      <span>⭐ ${ratingText(h)}</span><span>📍 ${distanceLabel(h)}</span>
      <span>🏥 ${esc(h.hospital_type)}</span><span>${h.is_247 ? "🚨 24/7 Emergency" : "🚨 Emergency (check hours)"}</span>
      <span style="color:var(--purple)">Match ${h._score}%</span>
    </div>
    <div class="chips">${specs}</div>
    <div class="h-actions">
      ${callButton(h, "btn-danger btn-sm", "Call")}
      <a class="btn btn-outline btn-sm" target="_blank" rel="noopener" href="${directionsLink(h, state.loc)}">🧭 Get Directions</a>
      <a class="btn btn-primary btn-sm" href="${hospitalLink(h)}">View Details</a>
    </div>`;
}

function bestMatchHTML(list, accident) {
  const [a, b, c] = list;
  const main = `
    <div class="best-main">
      <div class="score-ring" style="--p:${a._score}"><b>${a._score}%</b></div>
      <div>
        <span class="tag">#1 Best Match</span>
        <h3>${esc(a.name)}</h3>
        <strong style="font-size:.85rem;opacity:.9">Why this hospital?</strong>
        <ul class="why">${whyList(a, accident).map((w) => `<li>${esc(w)}</li>`).join("")}</ul>
        <div class="h-actions" style="margin-top:14px">
          <a class="btn btn-sm" style="background:#fff;color:var(--purple)" href="${hospitalLink(a)}">View Details</a>
          ${a.phone ? `<a class="btn btn-sm" style="background:rgba(255,255,255,.2);color:#fff" href="${telLink(a)}">📞 Call</a>` : ""}
        </div>
      </div>
    </div>`;
  const runner = (h, n) => h ? `
    <div class="runner" data-id="${h.id}">
      <div><small>#${n}</small><div><b>${esc(h.name)}</b></div><small>📍 ${distanceLabel(h)} · ⭐ ${ratingText(h)}</small></div>
      <span class="pct">${h._score}%</span>
    </div>` : "";
  return main + `<div class="best-side">${runner(b, 2)}${runner(c, 3)}</div>`;
}

/* ---------------------------------------------------------------
   5. PAGE CODE
   --------------------------------------------------------------- */
const state = {
  all: [], list: [], loc: null, accident: "Other Emergency", emergency: false, source: "",
  filters: { type: new Set(), avail: new Set(), spec: new Set(), sort: "match" },
  selectedId: null, map: null, layer: null, userMarker: null, markers: {}
};

document.addEventListener("DOMContentLoaded", () => {
  // responsive navbar
  const toggle = $("#navToggle"), links = $("#navLinks");
  if (toggle) toggle.addEventListener("click", () => links.classList.toggle("open"));
  fillAreaList();

  const page = document.body.dataset.page;
  if (page === "home") initHome();
  if (page === "accident") initAccident();
  if (page === "hospitals") initHospitals();
  if (page === "details") initDetails();
  if (page === "login") initLogin();
});

/* ---------- HOME ---------- */
function initHome() {
  const input = $("#locationInput"), select = $("#accidentSelect");
  const saved = STORE.get("loc"), savedAcc = STORE.get("accident");
  if (savedAcc) select.value = savedAcc;
  $$(".chip-btn").forEach((b) => b.addEventListener("click", () => {
    input.value = b.textContent.trim();
    // Known city names resolve locally, then go straight to hospital results.
    $("#searchForm").requestSubmit();
  }));
  if (saved && !saved.demo) input.value = saved.label;

  $("#btnUseLocation").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    setBusy(btn, true, "📡 Detecting location…");
    try {
      const loc = await getCurrentLocation();
      STORE.set("loc", loc);
      input.value = `Current location (${loc.lat.toFixed(3)}, ${loc.lng.toFixed(3)})`;
      showToast("Location detected. Now choose the accident type.", "success");
      $("#searchCard").scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (err) { showToast(err.message, "error", 5500); }
    setBusy(btn, false);
  });

  $("#btnSearchArea").addEventListener("click", () => {
    $("#searchCard").scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => input.focus(), 500);
  });

  $("#searchForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#btnFind"), text = input.value.trim();
    const saved = STORE.get("loc");
    let loc = null;
    if (text.startsWith("Current location") && saved) loc = saved;
    else if (text && saved && saved.label === text) loc = saved;
    else if (text) {
      setBusy(btn, true, "Searching…");
      loc = await geocodeArea(text);
      setBusy(btn, false);
      if (!loc) { showToast("Could not find that place. Try: village, district, state (example: Narsapur, Medak, Telangana).", "error"); return; }
    } else if (saved) loc = saved;
    else { showToast("Please enter a location or tap “Use Current Location”.", "warn"); input.focus(); return; }
    STORE.set("loc", loc);
    STORE.set("accident", select.value);
    window.location.href = "/hospitals?accident=" + encodeURIComponent(select.value);
  });

  $("#contactForm").addEventListener("submit", (e) => {
    e.preventDefault(); e.target.reset();
    showToast("Thanks! This is a demo form – your message was not stored.", "success");
  });
}

/* ---------- ACCIDENT TYPE PAGE ---------- */
function initAccident() {
  const cards = $$(".accident-card"), btn = $("#btnContinue"), hint = $("#accidentHint");
  let chosen = STORE.get("accident");
  const mark = () => {
    cards.forEach((c) => c.classList.toggle("selected", c.dataset.accident === chosen));
    const ok = cards.some((c) => c.dataset.accident === chosen);
    btn.disabled = !ok;
    hint.textContent = ok ? `Selected: ${chosen}` : "Select an accident type to continue.";
  };
  cards.forEach((c) => c.addEventListener("click", () => { chosen = c.dataset.accident; STORE.set("accident", chosen); mark(); }));
  btn.addEventListener("click", () => {
    if (!STORE.get("loc")) showToast("Tip: set your location on the next page for accurate distances.", "warn", 4500);
    window.location.href = "/hospitals?accident=" + encodeURIComponent(chosen);
  });
  mark();
}

/* ---------- LOGIN PAGE ---------- */
function initLogin() {
  const card = $("#authCard");
  let role = card.dataset.role === "staff" ? "staff" : "patient";
  let tab = card.dataset.tab === "register" ? "register" : "login";
  const hints = { patient: "Find hospitals and book appointments.", staff: "Manage patient appointments for your hospital." };
  const apply = () => {
    $("#formLogin").hidden = tab !== "login";
    $("#formRegister").hidden = tab !== "register";
    $$(".tabs [data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    $$(".role-switch [data-role]").forEach((b) => b.classList.toggle("active", b.dataset.role === role));
    $$('input[name="role"]').forEach((i) => (i.value = role));
    $$(".staff-only").forEach((box) => {            // hospital name + access code: staff registration only
      box.hidden = role !== "staff";
      $$("input, select, button", box).forEach((i) => (i.disabled = role !== "staff" || tab !== "register"));
    });
    $("#roleHint").textContent = hints[role];
  };
  $$(".tabs [data-tab]").forEach((b) => b.addEventListener("click", () => { tab = b.dataset.tab; apply(); }));
  $$(".role-switch [data-role]").forEach((b) => b.addEventListener("click", () => { role = b.dataset.role; apply(); }));
  // Hospital staff can load hospitals for ANY Indian city/town.
  const hospitalSelect = $("#staffHospitalSelect");
  const cityInput = $("#staffCitySearch");
  const citySearchBtn = $("#staffCitySearchBtn");
  if (hospitalSelect) {
    const hint = $("#staffHospitalHint");
    const link = $("#staffHospitalMapLink");
    const renderHospitalOptions = (hospitals, cityLabel) => {
      const previous = hospitalSelect.value;
      hospitalSelect.innerHTML = '<option value="">Select your hospital</option>';
      const groups = new Map();
      hospitals.forEach((hospital) => {
        const city = hospital.city || cityLabel || "Other";
        if (!groups.has(city)) groups.set(city, []);
        if (!groups.get(city).some((item) => item.name === hospital.name)) groups.get(city).push(hospital);
      });
      groups.forEach((items, city) => {
        const group = document.createElement("optgroup"); group.label = city;
        items.sort((a, b) => a.name.localeCompare(b.name)).forEach((hospital) => {
          const option = document.createElement("option");
          option.value = hospital.name; option.textContent = hospital.name;
          option.dataset.lat = hospital.latitude; option.dataset.lng = hospital.longitude;
          option.dataset.city = city; option.dataset.source = hospital.source || "OpenStreetMap";
          group.appendChild(option);
        });
        hospitalSelect.appendChild(group);
      });
      if (previous) hospitalSelect.value = previous;
      if (link) link.href = "/hospitals";
      if (hint) hint.textContent = `${hospitals.length} hospital choices loaded${cityLabel ? ` for ${cityLabel}` : ""}. Select one to view its map.`;
    };
    const updateMapLink = () => {
      const option = hospitalSelect.selectedOptions[0];
      if (!link) return;
      if (!option || !option.value) {
        link.href = "/hospitals"; link.textContent = "View hospitals on map"; return;
      }
      const city = option.dataset.city || "";
      link.href = `/hospitals?location=${encodeURIComponent(city)}&hospital=${encodeURIComponent(option.value)}`;
      link.textContent = `View ${option.value} on map`;
    };
    const searchCityHospitals = async () => {
      const city = cityInput ? cityInput.value.trim() : "";
      if (!city) { if (hint) hint.textContent = "Please enter a city or town name."; return; }
      if (citySearchBtn) { citySearchBtn.disabled = true; citySearchBtn.textContent = "Searching..."; }
      try {
        const response = await fetch(`/api/staff-hospitals?city=${encodeURIComponent(city)}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load hospitals for this city.");
        renderHospitalOptions(data.hospitals || [], data.city || city);
        if (!data.hospitals || !data.hospitals.length) {
          if (hint) hint.textContent = `No hospitals were listed for ${city} in OpenStreetMap. Try a nearby larger city or check the spelling.`;
        }
      } catch (error) {
        if (hint) hint.textContent = error.message || "Hospital search failed. Please try again.";
      } finally {
        if (citySearchBtn) { citySearchBtn.disabled = false; citySearchBtn.textContent = "Search hospitals in this city"; }
      }
    };
    fetch("/api/staff-hospitals")
      .then((response) => { if (!response.ok) throw new Error("Hospital list unavailable"); return response.json(); })
      .then((data) => renderHospitalOptions(data.hospitals || [], ""))
      .catch(() => { if (hint) hint.textContent = "Enter a city name and search to load hospitals from OpenStreetMap."; });
    if (citySearchBtn) citySearchBtn.addEventListener("click", searchCityHospitals);
    if (cityInput) cityInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); searchCityHospitals(); }
    });
    hospitalSelect.addEventListener("change", updateMapLink);
  }
  // eye button: show / hide the password
  $$(".eye-btn").forEach((btn) => btn.addEventListener("click", () => {
    const input = btn.parentElement.querySelector("input");
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    btn.querySelector(".eye-on").hidden = show;
    btn.querySelector(".eye-off").hidden = !show;
    btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
  }));
  apply();
}

/* ---------- HOSPITALS PAGE (map + cards + filters + ranking) ---------- */
async function initHospitals() {
  const params = new URLSearchParams(window.location.search);
  state.emergency = params.has("emergency");
  state.accident = params.get("accident") || STORE.get("accident") || "Other Emergency";
  STORE.set("accident", state.accident);
  $("#accidentSelect").value = state.accident;

  initMap();
  wireHospitalEvents();

  if (state.emergency) {              // Emergency mode: nearest 24/7 hospitals first
    $("#chk247").checked = true; state.filters.avail.add("247");
    state.filters.sort = "nearest"; $("#sortSelect").value = "nearest";
    $("#emergencyBanner").hidden = false;
    $("#resultsTitle").textContent = "Nearest 24/7 emergency hospitals";
  }

  // 1) decide the user's location
  const typed = params.get("location");
  let loc = null;
  if (typed) loc = await geocodeArea(typed);
  if (!loc) {
    const savedLoc = STORE.get("loc");
    // Ignore the old built-in Hyderabad demo default saved by earlier versions.
    if (savedLoc && !(savedLoc.demo && /hyderabad/i.test(savedLoc.label || ""))) loc = savedLoc;
  }
  if (!loc && state.emergency) {
    try { loc = await getCurrentLocation(); showToast("Using your current location.", "success"); }
    catch (err) { showToast(err.message, "warn", 5000); }
  }
  if (!loc) {
    loc = DEFAULT_LOC;
    showToast("Showing hospitals near Rajamahendravaram. You can search Rajahmundry, Kakinada or another area.", "info", 4500);
  }
  state.loc = loc; STORE.set("loc", loc);
  $("#locInput").value = loc.demo ? "" : loc.label;

  // 2) load hospitals from Flask (/api/hospitals)
  await loadHospitals();
}

async function fetchJSON(url) {
  const res = await fetch(url);
  let data = {};
  try { data = await res.json(); } catch (e) { /* not JSON */ }
  if (!res.ok) throw new Error(data.error || "Server error " + res.status);
  return data;
}

async function loadHospitals() {
  const cards = $("#cards");
  cards.innerHTML = `<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>`;
  try {
    let data;
    if (!state.loc.demo) {          // real place -> nearest real hospitals (OpenStreetMap)
      data = await fetchJSON(`/api/nearby?lat=${state.loc.lat}&lng=${state.loc.lng}`);
      if (!data.hospitals.length) {
        state.all = []; state.list = [];
        $("#bestSection").hidden = true; $("#resultsCount").textContent = "0 hospitals";
        cards.innerHTML = `<div class="empty"><div class="big">🔍</div><h3>No hospitals found near ${esc(state.loc.label)}</h3>
          <p class="muted">Try the nearest bigger town or mandal headquarters.</p></div>`;
        return;
      }
    } else {
      data = await fetchJSON("/api/hospitals");   // demo / MySQL data (Hyderabad demo only)
    }
    state.all = data.hospitals.map((h) => ({ ...h, id: String(h.id) }));
    state.source = data.source;
    if (["osm", "directory"].includes(data.source)) STORE.set("nearby", state.all);
    refresh(true);
    // Focus the selected hospital when opened from Hospital Staff Registration.
    const requestedHospital = new URLSearchParams(window.location.search).get("hospital");
    if (requestedHospital) {
      const norm = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const wanted = norm(requestedHospital);
      const match = state.all.find((h) => {
        const actual = norm(h.name);
        return actual === wanted || actual.includes(wanted) || wanted.includes(actual);
      });
      if (match) {
        selectHospital(String(match.id), "card");
        showToast(`Showing ${match.name} on the map.`, "success", 4500);
      } else {
        showToast(`${requestedHospital} was not found in the current map data. Nearby hospitals are shown instead; verify the exact pin before travelling.`, "warn", 6500);
      }
    }
    if (data.notice) showToast(data.notice, "info", 6500);
  } catch (err) {
    cards.innerHTML = `<div class="error-box"><div class="big">⚠️</div><h3>Could not load hospitals</h3>
      <p class="muted">${esc(err.message)}. Check your internet connection and that the Flask server is running.</p>
      <button class="btn btn-primary btn-sm" id="btnRetry" style="margin-top:14px">Try again</button></div>`;
    $("#btnRetry").addEventListener("click", loadHospitals);
    showToast("Could not load hospitals.", "error");
  }
}

function wireHospitalEvents() {
  // filters
  $$("[data-filter]").forEach((box) => box.addEventListener("change", () => {
    const set = state.filters[box.dataset.filter];
    box.checked ? set.add(box.value) : set.delete(box.value);
    refresh(false);
  }));
  $("#sortSelect").addEventListener("change", (e) => { state.filters.sort = e.target.value; refresh(false); });
  $("#accidentSelect").addEventListener("change", (e) => {
    state.accident = e.target.value; STORE.set("accident", state.accident); refresh(false);
  });
  $("#btnReset").addEventListener("click", () => {
    $$("[data-filter]").forEach((b) => (b.checked = false));
    state.filters.type.clear(); state.filters.avail.clear(); state.filters.spec.clear();
    state.filters.sort = "match"; $("#sortSelect").value = "match";
    refresh(false); showToast("Filters cleared.", "info", 2200);
  });
  $("#btnFilters").addEventListener("click", () => $("#sidebar").classList.toggle("open"));

  // location controls
  const setArea = async () => {
    const text = $("#locInput").value.trim(), btn = $("#btnSetArea");
    if (!text) { showToast("Type an area or city first.", "warn"); return; }
    setBusy(btn, true, "Searching…");
    const loc = await geocodeArea(text);
    setBusy(btn, false);
    if (!loc) { showToast("Could not find that place. Try: village, district, state (example: Narsapur, Medak, Telangana).", "error"); return; }
    changeLocation(loc);
  };
  $$(".hospital-city-chip").forEach((chip) => chip.addEventListener("click", async () => {
    $("#locInput").value = chip.dataset.city;
    await setArea();
  }));
  $("#btnSetArea").addEventListener("click", setArea);
  $("#locInput").addEventListener("keydown", (e) => { if (e.key === "Enter") setArea(); });
  $("#btnGeo").addEventListener("click", async (e) => {
    const btn = e.currentTarget; setBusy(btn, true, "📡 Detecting…");
    try { const loc = await getCurrentLocation(); changeLocation(loc); showToast("Location updated.", "success"); }
    catch (err) { showToast(err.message, "error", 5500); }
    setBusy(btn, false);
  });
  $("#btnDemoLoc").addEventListener("click", () => changeLocation(DEFAULT_LOC));

  // clicking cards / runner-up boxes
  $("#cards").addEventListener("click", (e) => {
    if (e.target.closest("a, button")) return;
    const card = e.target.closest(".h-card");
    if (card) selectHospital(card.dataset.id, "card");
  });
  $("#bestGrid").addEventListener("click", (e) => {
    const r = e.target.closest(".runner");
    if (r) { selectHospital(r.dataset.id, "card"); $("#map").scrollIntoView({ behavior: "smooth", block: "center" }); }
  });
  $("#quickView").addEventListener("click", (e) => { if (e.target.id === "qvClose") closeQuickView(); });
}

function changeLocation(loc) {
  state.loc = loc; STORE.set("loc", loc);
  $("#locInput").value = loc.demo ? "" : loc.label;
  state.selectedId = null; closeQuickView();
  loadHospitals();
}

// Re-calculate everything and redraw the page
function refresh(fitMap) {
  if (!state.all.length) return;
  state.all.forEach((h) => enrich(h, state.loc, state.accident));
  state.list = applyFilters(state.all);
  renderStatus(); renderBest(); renderCards(); renderMarkers(fitMap);
}

function applyFilters(all) {
  const f = state.filters;
  let list = all.filter((h) => {
    if (f.type.size && !f.type.has(h.hospital_type)) return false;
    if (f.avail.has("open") && !h._open) return false;
    if (f.avail.has("247") && !((h.is_247 || h.live) && h.emergency_available)) return false;   // live data rarely lists 24/7, so do not hide it
    if (f.avail.has("call") && !(h.emergency_status === "Call to Confirm" || !h.is_247)) return false;
    for (const s of f.spec) if (!h.specialties.includes(s)) return false;
    return true;
  });
  const sorters = {
    nearest: (a, b) => a._km - b._km,
    rating: (a, b) => (b.rating || 0) - (a.rating || 0) || a._km - b._km,
    match: (a, b) => b._score - a._score || a._km - b._km
  };
  return list.sort(sorters[f.sort]);
}

function renderStatus() {
  const near = Math.min(...state.all.map((h) => h._km));
  $("#statusRow").innerHTML = `
    <span class="pill">📍 ${esc(state.loc.label)}</span>
    <span class="pill blue">🩺 ${esc(state.accident)}</span>
    ${state.source === "osm"
      ? '<span class="pill green">🌍 Hospital locations (OpenStreetMap)</span><span class="pill orange">Ratings, beds &amp; blood not available – call to confirm</span>'
      : ["directory", "osm+directory"].includes(state.source)
        ? '<span class="pill blue">📚 OpenStreetMap + local hospital directory</span><span class="pill orange">Some pins are approximate city locations – confirm exact address by phone</span>'
        : `<span class="pill orange">🧪 Demo / sample hospital data${state.source === "mysql" ? " (from MySQL)" : ""}</span>`}`;
  const far = $("#farNotice");
  if (near > 60 && !state.loc.demo && !["osm", "directory", "osm+directory"].includes(state.source)) {
    far.hidden = false;
    $("#farNoticeText").textContent = `The nearest sample hospital is ${near.toFixed(0)} km from your location – the demo database only contains hospitals around Hyderabad.`;
  } else far.hidden = true;
}

function renderBest() {
  const section = $("#bestSection");
  if (!state.list.length) { section.hidden = true; return; }
  const ranked = [...state.list].sort((a, b) => b._score - a._score || a._km - b._km);
  section.hidden = false;
  $("#bestFor").textContent = state.accident;
  $("#bestGrid").innerHTML = bestMatchHTML(ranked, state.accident);
}

function renderCards() {
  const box = $("#cards");
  $("#resultsCount").textContent = `${state.list.length} hospital${state.list.length === 1 ? "" : "s"}`;
  if (!state.list.length) {
    box.innerHTML = `<div class="empty"><div class="big">🔍</div><h3>No hospitals match these filters</h3>
      <p class="muted">Try removing a filter or choosing a different area.</p>
      <button class="btn btn-primary btn-sm" id="btnEmptyReset" style="margin-top:14px">Reset filters</button></div>`;
    $("#btnEmptyReset").addEventListener("click", () => $("#btnReset").click());
    return;
  }
  box.innerHTML = state.list.map((h, i) => hospitalCard(h, i + 1, state.accident)).join("");
  // hovering a card highlights its marker
  $$(".h-card", box).forEach((c) => {
    c.addEventListener("mouseenter", () => setPinHighlight(c.dataset.id, true));
    c.addEventListener("mouseleave", () => setPinHighlight(c.dataset.id, false));
  });
  if (state.selectedId) $(`.h-card[data-id="${state.selectedId}"]`, box)?.classList.add("selected");
}

/* ----- Leaflet map ----- */
function initMap() {
  const el = $("#map");
  if (typeof L === "undefined") {
    el.innerHTML = `<div class="error-box" style="height:100%"><div class="big">🗺️</div><h3>Map could not load</h3><p class="muted">Check your internet connection (Leaflet and OpenStreetMap need it).</p></div>`;
    return;
  }
  state.map = L.map("map", { zoomControl: true }).setView([DEFAULT_LOC.lat, DEFAULT_LOC.lng], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: "&copy; OpenStreetMap contributors"
  }).addTo(state.map);
  state.layer = L.layerGroup().addTo(state.map);
}

function pinIcon(rank, selected) {
  return L.divIcon({
    className: "", html: `<div class="pin ${selected ? "pin-sel" : ""}"><span>${rank}</span></div>`,
    iconSize: selected ? [42, 42] : [34, 34], iconAnchor: selected ? [21, 42] : [17, 34], popupAnchor: [0, -34]
  });
}

function renderMarkers(fit) {
  if (!state.map) return;
  state.layer.clearLayers(); state.markers = {};
  if (state.userMarker) state.map.removeLayer(state.userMarker);
  state.userMarker = L.marker([state.loc.lat, state.loc.lng], {
    icon: L.divIcon({ className: "", html: '<div class="user-pin"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
    zIndexOffset: 1000
  }).addTo(state.map).bindPopup(`<strong>📍 You are here</strong><br>${esc(state.loc.label)}`);

  const points = [[state.loc.lat, state.loc.lng]];
  state.list.forEach((h, i) => {
    if (h.approximate_location) return; // fallback records have city-centre coordinates, not exact pins
    const m = L.marker([h.latitude, h.longitude], { icon: pinIcon(i + 1, h.id === state.selectedId) })
      .bindPopup(`<strong>${esc(h.name)}</strong><br>📍 ${h._km.toFixed(1)} km · ⭐ ${ratingText(h)}`)
      .on("click", () => selectHospital(h.id, "map"));
    m.addTo(state.layer); state.markers[h.id] = { marker: m, rank: i + 1 };
    points.push([h.latitude, h.longitude]);
  });
  if (fit && points.length > 1) {
    // zoom to the nearest few hospitals so the map is not zoomed out too far
    const near = state.list.slice(0, 5).map((h) => [h.latitude, h.longitude]);
    state.map.fitBounds([[state.loc.lat, state.loc.lng], ...near], { padding: [50, 50], maxZoom: 14 });
  } else if (fit) state.map.setView([state.loc.lat, state.loc.lng], 13);
  setTimeout(() => state.map.invalidateSize(), 200);
}

function setPinHighlight(id, on) {
  const m = state.markers[id]; if (!m) return;
  m.marker.setIcon(pinIcon(m.rank, on || id === state.selectedId));
}

function selectHospital(id, from) {
  const prev = state.selectedId; state.selectedId = id;
  if (prev && state.markers[prev]) state.markers[prev].marker.setIcon(pinIcon(state.markers[prev].rank, false));
  const m = state.markers[id];
  if (m) {
    m.marker.setIcon(pinIcon(m.rank, true));
    if (from === "card") { state.map.flyTo(m.marker.getLatLng(), Math.max(state.map.getZoom(), 14), { duration: 0.6 }); m.marker.openPopup(); }
  }
  $$(".h-card").forEach((c) => c.classList.toggle("selected", c.dataset.id === String(id)));
  const h = state.all.find((x) => String(x.id) === String(id));
  const qv = $("#quickView"); qv.innerHTML = quickViewHTML(h); qv.hidden = false;
  if (from === "map") $(`.h-card[data-id="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function closeQuickView() {
  $("#quickView").hidden = true;
  const prev = state.selectedId; state.selectedId = null;
  if (prev && state.markers[prev]) state.markers[prev].marker.setIcon(pinIcon(state.markers[prev].rank, false));
  $$(".h-card.selected").forEach((c) => c.classList.remove("selected"));
}

/* ---------- HOSPITAL DETAILS PAGE ---------- */
async function initDetails() {
  const root = $("#detailRoot"), id = $("#detailPage").dataset.hospitalId;
  const loc = STORE.get("loc") || DEFAULT_LOC;
  const accident = STORE.get("accident") || "Other Emergency";
  try {
    const ref = new URLSearchParams(window.location.search).get("ref");
    let h;
    if (ref) {                      // live hospital: saved in the browser by the hospitals page
      h = (STORE.get("nearby", []) || []).find((x) => String(x.id) === ref);
      if (!h) throw new Error("Please open this hospital from the Find Hospitals list.");
    } else {
      const res = await fetch(`/api/hospital/${id}`);
      if (!res.ok) throw new Error("Hospital not found");
      h = (await res.json()).hospital;
    }
    enrich(h, loc, accident);
    state.loc = loc;
    root.innerHTML = detailsHTML(h, loc, accident);
    $("#backLink").href = "/hospitals?accident=" + encodeURIComponent(accident);
    drawDetailMap(h, loc);
  } catch (err) {
    root.innerHTML = `<div class="error-box"><div class="big">⚠️</div><h3>Could not load this hospital</h3><p class="muted">${esc(err.message)}</p></div>`;
    showToast("Could not load hospital details.", "error");
  }
}

// "Book Appointment" panel (details page). Patients get a form, others get a login hint.
function bookingPanel(h) {
  const role = document.body.dataset.role;
  const pad = (n) => String(n).padStart(2, "0");
  const d = new Date(), today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const slots = []; for (let hr = 9; hr < 18; hr++) for (const m of [0, 30]) slots.push(`${pad(hr)}:${pad(m)}`);
  let body;
  if (role === "patient") {
    const depts = ["General Physician", ...h.specialties.filter((s) => s !== "General Physician")];
    body = `
      <form method="post" action="/appointments/book" class="book-grid">
        <input type="hidden" name="hospital_ref" value="${esc(h.id)}">
        <input type="hidden" name="hospital_name" value="${esc(h.name)}">
        <div class="field"><label>Patient name</label><input class="input" name="patient_name" value="${esc(document.body.dataset.user)}" required></div>
        <div class="field"><label>Phone</label><input class="input" name="phone" inputmode="tel" placeholder="Mobile number" required></div>
        <div class="field"><label>Department</label><select class="input" name="department">${depts.map((x) => `<option>${esc(x)}</option>`).join("")}</select></div>
        <div class="field"><label>Date</label><input class="input" type="date" name="appt_date" min="${today}" value="${today}" required></div>
        <div class="field"><label>Time slot</label><select class="input" name="slot">${slots.map((x) => `<option>${x}</option>`).join("")}</select></div>
        <div class="field"><label>Reason (optional)</label><input class="input" name="reason" maxlength="300" placeholder="e.g. follow-up after fracture"></div>
        <div class="full"><button class="btn btn-primary" type="submit">📅 Request Appointment</button>
          <p class="mini-note">The hospital staff confirm your request. This is a demo booking – please also call the hospital to confirm.</p></div>
      </form>`;
  } else if (role === "staff") {
    body = `<p class="muted">You are logged in as hospital staff. Patients book here – manage requests in your <a href="/staff" style="color:var(--purple);font-weight:700">Staff Dashboard</a>.</p>`;
  } else {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    body = `<p class="muted">Login as a patient to book an appointment with this hospital.</p>
      <a class="btn btn-primary btn-sm" style="margin-top:12px" href="/login?next=${next}">🔐 Login / Register to book</a>`;
  }
  return `<section class="panel fade-in" id="book" style="margin-top:22px"><h2>📅 Book Appointment</h2>${body}</section>`;
}

function detailsHTML(h, loc, accident) {
  const pill = availabilityPill(h);
  const yn = (v) => (v == null ? '<span class="pill gray">Unknown</span>' : `<span class="pill ${v ? "green" : "gray"}">${v ? "Yes" : "No"}</span>`);
  const bedsPct = h.available_beds == null ? 0 : Math.round((h.available_beds / Math.max(h.total_beds, 1)) * 100);
  const bloodCls = { Available: "green", Limited: "orange", Unknown: "gray" }[h.blood_status] || "red";
  const breakdown = Object.entries(h._parts).map(([k, [v, max]]) => `
    <div class="row"><div><span>${k}</span><span>${v.toFixed(1)} / ${max}</span></div>
    <div class="bar"><i style="width:${Math.min(100, (v / max) * 100)}%"></i></div></div>`).join("");
  const badges = h.specialties.map((s) => `<span class="badge ${h._matched.includes(s) ? "match" : ""}">${esc(s)}</span>`).join("");
  return `
  <section class="detail-hero fade-in">
    <div class="h-img">${hospitalImage(h)}</div>
    <div>
      <div class="chips">
        <span class="pill blue">🏥 ${esc(h.hospital_type)}</span>
        <span class="pill ${pill.cls}">🚨 ${pill.text}</span>
        <span class="pill ${openPill(h).cls}">${openPill(h).text}</span>
      </div>
      <h1>${esc(h.name)}</h1>
      <div><span class="rating">⭐ ${ratingText(h)}</span>
        <span class="muted" style="margin-left:8px">${h.live ? "Rating not available in map data" : (h.reviews_count || 0).toLocaleString("en-IN") + " reviews"}</span></div>
      <div class="info-grid">
        <div class="info-item"><small>Address</small><strong>${esc(h.address)}</strong></div>
        <div class="info-item"><small>Distance</small><strong>📍 ${distanceLabel(h)}</strong></div>
        <div class="info-item"><small>Phone</small><strong>${esc(h.phone)}</strong></div>
        <div class="info-item"><small>Working hours</small><strong>${esc(hoursText(h))}</strong></div>
      </div>
      <div class="h-actions">
        ${callButton(h, "btn-danger", "Call Hospital")}
        <a class="btn btn-primary" target="_blank" rel="noopener" href="${directionsLink(h, loc)}">🧭 Get Directions</a>
        <a class="btn btn-outline" href="#book">📅 Book Appointment</a>
      </div>
    </div>
  </section>

  <div class="detail-cols">
    <section class="panel fade-in">
      <h2>🚨 Emergency Information</h2>
      <ul class="tick-list">
        <li>Emergency department ${yn(h.emergency_available)}</li>
        <li>24/7 availability ${yn(h.live && !h.is_247 ? null : h.is_247)}</li>
        <li>ICU availability ${yn(h.icu_available)}</li>
        <li>Ambulance availability ${yn(h.ambulance_available)}</li>
        <li>Trauma care ${yn(h.live && !h.specialties.length ? null : h.specialties.includes("Trauma"))}</li>
      </ul>
    </section>
    <section class="panel fade-in">
      <h2>🛏️ Availability <span class="muted" style="font-size:.75rem;font-weight:600">(${h.live ? "live data not available – call to confirm" : "demo data"})</span></h2>
      <ul class="tick-list">
        <li>Status <span class="pill ${h._open ? "green" : "gray"}">${h._open ? "Open" : "Closed"}</span></li>
        <li>Emergency <span class="pill ${pill.cls}">${pill.text}</span></li>
        <li>ICU beds <strong>${h.icu_beds ?? "Unknown"}</strong></li>
        <li>Blood availability <span class="pill ${bloodCls}">${esc(h.blood_status)}</span></li>
      </ul>
      <div class="bar-label"><span>General beds available</span><span>${h.available_beds == null ? "Not available in map data" : h.available_beds + " / " + h.total_beds}</span></div>
      <div class="bar"><i style="width:${bedsPct}%"></i></div>
      <p class="mini-note">Always call the hospital to confirm availability.</p>
    </section>
  </div>

  <section class="panel fade-in" style="margin-top:22px">
    <h2>🩺 Specialties</h2>
    <div class="badges">${badges}</div>
    <p class="mini-note">Highlighted badges match your selected accident type: <b>${esc(accident)}</b>.</p>
  </section>

  ${bookingPanel(h)}

  <div class="detail-cols">
    <section class="panel fade-in">
      <h2>⭐ Best Hospital Match for ${esc(accident)}</h2>
      <div style="display:grid;grid-template-columns:auto 1fr;gap:20px;align-items:center">
        <div class="score-ring" style="--p:${h._score};background:conic-gradient(var(--purple) calc(var(--p)*1%),var(--lavender-2) 0)">
          <b style="color:var(--purple)">${h._score}%</b>
        </div>
        <div><b>Why this hospital?</b>
          <ul class="why" style="margin-top:6px;color:var(--ink)">${whyList(h, accident).map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>
      </div>
      <div class="breakdown" style="margin-top:16px">${breakdown}</div>
      <p class="mini-note">This is a comparison score, not a medical diagnosis or advice.</p>
    </section>
    <section class="panel fade-in">
      <h2>🗺️ Location</h2>
      <div id="detailMap"></div>
    </section>
  </div>`;
}

function drawDetailMap(h, loc) {
  if (typeof L === "undefined") { $("#detailMap").innerHTML = '<p class="muted" style="padding:20px">Map needs an internet connection.</p>'; return; }
  const targetLat = h.latitude, targetLng = h.longitude;
  const map = L.map("detailMap").setView([targetLat, targetLng], h.approximate_location ? 12 : 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }).addTo(map);
  if (!h.approximate_location) {
    L.marker([targetLat, targetLng], { icon: pinIcon("✚", true) }).addTo(map).bindPopup(`<strong>${esc(h.name)}</strong>`).openPopup();
  }
  L.marker([loc.lat, loc.lng], { icon: L.divIcon({ className: "", html: '<div class="user-pin"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }) })
    .addTo(map).bindPopup("You are here");
  if (!h.approximate_location) map.fitBounds([[targetLat, targetLng], [loc.lat, loc.lng]], { padding: [40, 40], maxZoom: 14 });
  setTimeout(() => map.invalidateSize(), 200);
}
