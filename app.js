/**
 * app.js
 * Production-ready EV Charging Station Finder & Trip Planner (Thailand)
 * Google Maps Platform JS API + Firebase Firestore Real-Time Integration
 * Solution Attribution: gmp_mcp_codeassist_v1_aistudio
 */

import {
  seedMockStations,
  subscribeToStations,
  updateStationConnectorStatus,
  addStationCheckIn,
  toggleRealtimeSimulation,
  localStore
} from "./firebase-config.js";

// Global App State
const state = {
  stations: [],
  filteredStations: [],
  selectedStation: null,
  userLocation: { lat: 13.7563, lng: 100.5018 }, // Bangkok default
  hasUserLocation: false,
  isSimulationActive: false,
  isGoogleMapsLoaded: false,
  googleMap: null,
  activeMarkers: new Map(), // stationId -> AdvancedMarkerElement or Marker
  directionsService: null,
  directionsRenderer: null,
  routeResult: null,
  suggestedStop: null,
  filters: {
    searchQuery: "",
    onlyAvailable: false,
    speed: "all", // 'all' | 'dc' | 'ultra'
    connectors: new Set(), // 'CCS2', 'Type 2', 'CHAdeMO'
    operator: "all"
  },
  planner: {
    origin: { name: "กรุงเทพมหานคร (Bangkok)", lat: 13.7563, lng: 100.5018 },
    destination: { name: "เขาใหญ่ ปากช่อง (Khao Yai)", lat: 14.6852, lng: 101.4085 },
    batteryCapacity: 60.5,
    currentSoc: 65,
    consumptionRate: 6.2, // km / kWh
    targetArrivalSoc: 20
  }
};

// Popular Thai Destination coordinates for instant routing
const POPULAR_DESTINATIONS = {
  "เขาใหญ่ ปากช่อง (Khao Yai)": { lat: 14.6852, lng: 101.4085, name: "เขาใหญ่ ปากช่อง (Khao Yai)" },
  "พัทยา ชลบุรี (Pattaya)": { lat: 12.9236, lng: 100.8825, name: "พัทยา ชลบุรี (Pattaya)" },
  "หัวหิน ประจวบคีรีขันธ์ (Hua Hin)": { lat: 12.5684, lng: 99.9577, name: "หัวหิน ประจวบคีรีขันธ์ (Hua Hin)" },
  "อยุธยา (Ayutthaya)": { lat: 14.3532, lng: 100.5684, name: "อยุธยา (Ayutthaya)" },
  "เชียงใหม่ (Chiang Mai)": { lat: 18.7883, lng: 98.9853, name: "เชียงใหม่ (Chiang Mai)" }
};

// Vehicle Presets Data
const VEHICLE_PRESETS = {
  "byd-atto3": { name: "BYD Atto 3 Extended", capacity: 60.5, rate: 6.2 },
  "byd-dolphin": { name: "BYD Dolphin Standard", capacity: 44.9, rate: 6.5 },
  "byd-seal": { name: "BYD Seal Premium RWD", capacity: 82.5, rate: 5.8 },
  "tesla-modely": { name: "Tesla Model Y RWD", capacity: 60.0, rate: 6.4 },
  "mg4": { name: "MG4 Electric", capacity: 51.0, rate: 6.0 },
  "ora-goodcat": { name: "GWM ORA Good Cat 500", capacity: 47.8, rate: 6.1 }
};

// Toast Notification Helper
function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  const bg = type === "success" ? "bg-emerald-950/95 border-emerald-500/50 text-emerald-200" 
    : type === "warning" ? "bg-amber-950/95 border-amber-500/50 text-amber-200" 
    : type === "error" ? "bg-rose-950/95 border-rose-500/50 text-rose-200" 
    : "bg-slate-900/95 border-slate-700 text-slate-200";

  toast.className = `flex items-center gap-2 px-4 py-2.5 rounded-2xl border ${bg} shadow-2xl backdrop-blur-xl text-xs animate-in fade-in slide-in-from-bottom duration-300 pointer-events-auto`;
  toast.innerHTML = `
    <span class="w-2 h-2 rounded-full ${type === 'success' ? 'bg-emerald-400' : type === 'warning' ? 'bg-amber-400' : 'bg-sky-400'} shrink-0"></span>
    <span class="flex-1">${message}</span>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("opacity-0", "transition-opacity", "duration-300");
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Calculate Thailand TOU (Time of Use) On-Peak vs Off-Peak
export function getThailandTOUStatus() {
  const now = new Date();
  // Thailand is UTC+7
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const thaiTime = new Date(utc + (3600000 * 7));
  const day = thaiTime.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const hour = thaiTime.getHours();

  // Weekend (Sat, Sun) is all day Off-Peak
  if (day === 0 || day === 6) {
    return {
      isOnPeak: false,
      text: "ขณะนี้ช่วง Off-Peak (วันหยุด)",
      rateType: "offPeak",
      badgeClass: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
    };
  }

  // Monday - Friday: 09:00 - 22:00 is On-Peak
  if (hour >= 9 && hour < 22) {
    return {
      isOnPeak: true,
      text: "ขณะนี้ช่วง On-Peak (09:00 - 22:00 น.)",
      rateType: "onPeak",
      badgeClass: "bg-amber-500/20 text-amber-300 border-amber-500/30"
    };
  } else {
    return {
      isOnPeak: false,
      text: "ขณะนี้ช่วง Off-Peak (ประหยัดกว่า)",
      rateType: "offPeak",
      badgeClass: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
    };
  }
}

// Calculate Station Availability Status: 'available' | 'occupied' | 'offline'
export function getStationOverallStatus(station) {
  if (!station.connectors || station.connectors.length === 0) return "offline";
  const hasAvailable = station.connectors.some(c => c.status === "available");
  if (hasAvailable) return "available";
  const hasOccupied = station.connectors.some(c => c.status === "occupied");
  if (hasOccupied) return "occupied";
  return "offline";
}

// Calculate Haversine Distance in Kilometers
export function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

// Initialize Application
async function initApp() {
  console.log("⚡ [EV App] Initializing EV Charging Station Finder & Trip Planner...");
  
  // Seed mock stations into Firestore / Local Reactive Store
  await seedMockStations();

  // Initialize Real-time Firestore Subscription
  subscribeToStations((updatedStations) => {
    state.stations = updatedStations;
    applyFilters();
    updateMapMarkers();
    updateMapSummaryCounts();
    
    // If detail drawer is currently open, refresh its contents
    if (state.selectedStation) {
      const refreshed = updatedStations.find(s => s.id === state.selectedStation.id);
      if (refreshed) {
        state.selectedStation = refreshed;
        renderStationDetail(refreshed);
      }
    }
  });

  // Attempt to acquire HTML5 Geolocation with fallback
  acquireUserLocation();

  // Setup Google Maps Platform JS API (or Vector Canvas Fallback)
  setupMapsPlatform();

  // Setup UI Event Listeners
  setupEventListeners();

  // Update TOU Pill
  updateTOUDisplay();
  setInterval(updateTOUDisplay, 60000);

  // Initialize Lucide Icons
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// Location Acquisition
function acquireUserLocation() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        state.userLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        };
        state.hasUserLocation = true;
        console.log("📍 User location acquired:", state.userLocation);
        state.planner.origin = {
          name: "ตำแหน่งปัจจุบันของคุณ (Current GPS)",
          lat: state.userLocation.lat,
          lng: state.userLocation.lng
        };
        const originInput = document.getElementById("route-origin-input");
        if (originInput) originInput.value = "ตำแหน่งปัจจุบันของคุณ";
        
        if (state.googleMap) {
          state.googleMap.panTo(state.userLocation);
        }
        applyFilters();
      },
      (error) => {
        console.warn("⚠️ Geolocation error or denied (using Bangkok center):", error.message);
        state.userLocation = { lat: 13.7563, lng: 100.5018 }; // Bangkok
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  }
}

// Setup Google Maps Platform JS API
async function setupMapsPlatform() {
  const customKey = localStorage.getItem("gmp_api_key") || import.meta.env?.VITE_GOOGLE_MAPS_API_KEY;

  if (window.google && window.google.maps) {
    initGoogleMapInstance();
    return;
  }

  // If key is available or user configured one, load Google Maps script
  if (customKey && customKey.trim() !== "") {
    try {
      await loadGoogleMapsScript(customKey);
      initGoogleMapInstance();
      return;
    } catch (e) {
      console.warn("⚠️ Failed to load Google Maps with key, falling back to Interactive Canvas Map:", e);
    }
  }

  // Fallback: Activate Vector Canvas Interactive Map
  console.log("ℹ️ Activating Interactive Vector Map Canvas (Zero-dependency preview)");
  initVectorMapFallback();
}

function loadGoogleMapsScript(apiKey) {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.maps) return resolve();
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,marker,routes,geometry&v=weekly`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = (err) => reject(err);
    document.head.appendChild(script);
  });
}

function initGoogleMapInstance() {
  const mapElement = document.getElementById("map");
  if (!mapElement || !window.google || !window.google.maps) return;

  const mapOptions = {
    center: state.userLocation,
    zoom: 11,
    mapId: "DEMO_MAP_ID", // Required for AdvancedMarkerElement
    disableDefaultUI: false,
    zoomControl: true,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
    // Mandatory Google Maps attribution tracking
    internalUsageAttributionIds: ["gmp_mcp_codeassist_v1_aistudio"]
  };

  state.googleMap = new google.maps.Map(mapElement, mapOptions);
  state.directionsService = new google.maps.DirectionsService();
  state.directionsRenderer = new google.maps.DirectionsRenderer({
    map: state.googleMap,
    suppressMarkers: false,
    polylineOptions: {
      strokeColor: "#10b981", // Emerald route line
      strokeWeight: 5,
      strokeOpacity: 0.85
    }
  });

  state.isGoogleMapsLoaded = true;
  document.getElementById("map-fallback")?.classList.add("hidden");
  updateMapMarkers();
}

// High-fidelity Vector Map Canvas Fallback
let canvasMap = {
  canvas: null,
  ctx: null,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  isDragging: false,
  dragStart: { x: 0, y: 0 }
};

function initVectorMapFallback() {
  const fallbackDiv = document.getElementById("map-fallback");
  const canvas = document.getElementById("vector-map-canvas");
  if (!fallbackDiv || !canvas) return;

  fallbackDiv.classList.remove("hidden");
  canvasMap.canvas = canvas;
  canvasMap.ctx = canvas.getContext("2d");

  function resize() {
    canvas.width = fallbackDiv.clientWidth * window.devicePixelRatio;
    canvas.height = fallbackDiv.clientHeight * window.devicePixelRatio;
    drawVectorMap();
  }
  window.addEventListener("resize", resize);
  resize();

  // Interactive Pan & Zoom
  fallbackDiv.addEventListener("mousedown", (e) => {
    canvasMap.isDragging = true;
    canvasMap.dragStart = { x: e.clientX - canvasMap.offsetX, y: e.clientY - canvasMap.offsetY };
  });

  window.addEventListener("mousemove", (e) => {
    if (!canvasMap.isDragging) return;
    canvasMap.offsetX = e.clientX - canvasMap.dragStart.x;
    canvasMap.offsetY = e.clientY - canvasMap.dragStart.y;
    drawVectorMap();
  });

  window.addEventListener("mouseup", () => {
    canvasMap.isDragging = false;
  });

  fallbackDiv.addEventListener("wheel", (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.88;
    canvasMap.scale = Math.min(Math.max(canvasMap.scale * zoomFactor, 0.5), 5);
    drawVectorMap();
  });

  // Click on Station Pins
  fallbackDiv.addEventListener("click", (e) => {
    const rect = canvas.getBoundingClientRect();
    const clickX = (e.clientX - rect.left) * window.devicePixelRatio;
    const clickY = (e.clientY - rect.top) * window.devicePixelRatio;

    for (const st of state.filteredStations) {
      const pt = latLngToCanvasXY(st.coordinates.lat, st.coordinates.lng);
      const dist = Math.hypot(clickX - pt.x, clickY - pt.y);
      if (dist < 28) {
        selectStation(st);
        break;
      }
    }
  });

  drawVectorMap();
}

function latLngToCanvasXY(lat, lng) {
  const w = canvasMap.canvas.width;
  const h = canvasMap.canvas.height;
  // Thailand geographic bounding box ~ 12.0 - 15.0 Lat, 99.5 - 101.5 Lng
  const minLat = 12.2, maxLat = 15.0;
  const minLng = 99.4, maxLng = 101.8;

  const normalizedX = (lng - minLng) / (maxLng - minLng);
  const normalizedY = 1 - (lat - minLat) / (maxLat - minLat);

  const centerX = w / 2;
  const centerY = h / 2;

  const rawX = (normalizedX * w - centerX) * canvasMap.scale + centerX + canvasMap.offsetX * window.devicePixelRatio;
  const rawY = (normalizedY * h - centerY) * canvasMap.scale + centerY + canvasMap.offsetY * window.devicePixelRatio;

  return { x: rawX, y: rawY };
}

function drawVectorMap() {
  if (!canvasMap.ctx || !canvasMap.canvas) return;
  const ctx = canvasMap.ctx;
  const w = canvasMap.canvas.width;
  const h = canvasMap.canvas.height;

  ctx.clearRect(0, 0, w, h);

  // Background Grid & Roads
  ctx.fillStyle = "#090d16";
  ctx.fillRect(0, 0, w, h);

  // Draw Subtle Highway Arteries (Bangkok to Ayutthaya, Khao Yai, Chonburi, Hua Hin)
  ctx.strokeStyle = "rgba(71, 85, 105, 0.4)";
  ctx.lineWidth = 3 * canvasMap.scale;
  ctx.lineCap = "round";

  const highways = [
    // Highway 1 & 32: Bangkok -> Ayutthaya
    [{ lat: 13.7563, lng: 100.5018 }, { lat: 13.85, lng: 100.57 }, { lat: 14.2255, lng: 100.716 }, { lat: 14.35, lng: 100.58 }],
    // Mittraphap Rd: Ayutthaya/Wang Noi -> Khao Yai/Pak Chong
    [{ lat: 14.2255, lng: 100.716 }, { lat: 14.6852, lng: 101.4085 }],
    // Motorway 7: Bangkok -> Chonburi -> Pattaya
    [{ lat: 13.7563, lng: 100.5018 }, { lat: 13.65, lng: 100.68 }, { lat: 13.432, lng: 100.998 }, { lat: 12.9236, lng: 100.8825 }],
    // Rama 2: Bangkok -> Samut Sakhon -> Hua Hin
    [{ lat: 13.7563, lng: 100.5018 }, { lat: 13.6288, lng: 100.414 }, { lat: 12.6321, lng: 99.9512 }]
  ];

  highways.forEach(hw => {
    ctx.beginPath();
    hw.forEach((pt, i) => {
      const c = latLngToCanvasXY(pt.lat, pt.lng);
      if (i === 0) ctx.moveTo(c.x, c.y);
      else ctx.lineTo(c.x, c.y);
    });
    ctx.stroke();
  });

  // If a route line is plotted, draw it in bright Emerald
  if (state.routeResult) {
    ctx.strokeStyle = "#10b981";
    ctx.lineWidth = 6 * canvasMap.scale;
    ctx.beginPath();
    const pOrigin = latLngToCanvasXY(state.planner.origin.lat, state.planner.origin.lng);
    ctx.moveTo(pOrigin.x, pOrigin.y);
    if (state.suggestedStop) {
      const pStop = latLngToCanvasXY(state.suggestedStop.coordinates.lat, state.suggestedStop.coordinates.lng);
      ctx.lineTo(pStop.x, pStop.y);
    }
    const pDest = latLngToCanvasXY(state.planner.destination.lat, state.planner.destination.lng);
    ctx.lineTo(pDest.x, pDest.y);
    ctx.stroke();
  }

  // Draw Station Markers
  state.filteredStations.forEach(st => {
    const pt = latLngToCanvasXY(st.coordinates.lat, st.coordinates.lng);
    const overallStatus = getStationOverallStatus(st);
    const color = overallStatus === "available" ? "#10b981" : overallStatus === "occupied" ? "#f59e0b" : "#ef4444";
    const isSelected = state.selectedStation?.id === st.id;

    // Outer Glow / Ring
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, (isSelected ? 20 : 14) * canvasMap.scale, 0, Math.PI * 2);
    ctx.fillStyle = isSelected ? "rgba(16, 185, 129, 0.35)" : "rgba(15, 23, 42, 0.7)";
    ctx.fill();

    // Pin Body
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, (isSelected ? 14 : 10) * canvasMap.scale, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2 * canvasMap.scale;
    ctx.stroke();

    // Fast charge indicator badge (lightning dot)
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 3 * canvasMap.scale, 0, Math.PI * 2);
    ctx.fill();

    // Station Name Label
    ctx.font = `${Math.max(10 * canvasMap.scale, 10)}px 'Prompt', sans-serif`;
    ctx.fillStyle = "#e2e8f0";
    ctx.textAlign = "center";
    ctx.fillText(st.name.split(" ")[0] + " " + (st.name.split(" ")[1] || ""), pt.x, pt.y + 22 * canvasMap.scale);
  });
}

// Update Map Markers on Google Maps
function updateMapMarkers() {
  if (!state.isGoogleMapsLoaded || !state.googleMap) {
    if (!state.isGoogleMapsLoaded) {
      drawVectorMap();
    }
    return;
  }

  // Clear obsolete markers
  state.activeMarkers.forEach((marker, id) => {
    if (!state.filteredStations.some(s => s.id === id)) {
      marker.map = null;
      state.activeMarkers.delete(id);
    }
  });

  // Create or update markers for filtered stations
  state.filteredStations.forEach(station => {
    const overallStatus = getStationOverallStatus(station);
    const color = overallStatus === "available" ? "#10b981" : overallStatus === "occupied" ? "#f59e0b" : "#ef4444";
    const isSelected = state.selectedStation?.id === station.id;

    if (state.activeMarkers.has(station.id)) {
      const existing = state.activeMarkers.get(station.id);
      // Update position or appearance if needed
      return;
    }

    // Use AdvancedMarkerElement if available
    if (google.maps.marker && google.maps.marker.AdvancedMarkerElement) {
      const pinContainer = document.createElement("div");
      pinContainer.className = "cursor-pointer transition-transform duration-200 hover:scale-125";
      pinContainer.innerHTML = `
        <div class="relative flex items-center justify-center">
          <div class="w-8 h-8 rounded-full flex items-center justify-center text-white shadow-xl ${
            overallStatus === 'available' ? 'bg-emerald-500 shadow-emerald-500/50' : overallStatus === 'occupied' ? 'bg-amber-500 shadow-amber-500/50' : 'bg-rose-500 shadow-rose-500/50'
          } border-2 border-white">
            <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
          </div>
          <span class="absolute -bottom-5 px-1.5 py-0.5 rounded bg-slate-900/90 border border-slate-700 text-[9px] font-bold text-slate-100 whitespace-nowrap shadow-md">
            ${station.operator.split(" ")[0]}
          </span>
        </div>
      `;

      const marker = new google.maps.marker.AdvancedMarkerElement({
        map: state.googleMap,
        position: station.coordinates,
        title: station.name,
        content: pinContainer
      });

      pinContainer.addEventListener("click", () => {
        selectStation(station);
      });

      state.activeMarkers.set(station.id, marker);
    } else {
      // Classic Marker Fallback
      const marker = new google.maps.Marker({
        position: station.coordinates,
        map: state.googleMap,
        title: station.name,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 9,
          fillColor: color,
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2
        }
      });
      marker.addListener("click", () => selectStation(station));
      state.activeMarkers.set(station.id, marker);
    }
  });
}

// Select a Station and Open the Drawer
export function selectStation(station) {
  state.selectedStation = station;
  renderStationDetail(station);

  // Pan map to station
  if (state.isGoogleMapsLoaded && state.googleMap) {
    state.googleMap.panTo(station.coordinates);
    state.googleMap.setZoom(14);
  } else {
    // Focus vector map
    canvasMap.offsetX = 0;
    canvasMap.offsetY = 0;
    drawVectorMap();
  }

  // Open Drawer (slide-up)
  const drawer = document.getElementById("station-drawer");
  if (drawer) {
    drawer.classList.remove("translate-y-full", "md:translate-x-full");
  }
}

// Render Station Detail in Drawer
function renderStationDetail(station) {
  const nameEl = document.getElementById("drawer-station-name");
  const nameEnEl = document.getElementById("drawer-station-name-en");
  const opBadge = document.getElementById("drawer-operator-badge");
  const statusBadge = document.getElementById("drawer-status-badge");
  const addressEl = document.getElementById("drawer-station-address");
  const coordsEl = document.getElementById("drawer-coords-text");
  const distEl = document.getElementById("drawer-distance-text");
  const connectorsList = document.getElementById("drawer-connectors-list");
  const connCountEl = document.getElementById("drawer-connectors-count");
  const amenitiesList = document.getElementById("drawer-amenities-list");
  const reviewsList = document.getElementById("drawer-reviews-list");
  const reviewsCountEl = document.getElementById("drawer-reviews-count");

  if (!nameEl) return;

  nameEl.textContent = station.name;
  nameEnEl.textContent = station.nameEn || "";
  opBadge.textContent = station.operator;
  opBadge.style.backgroundColor = station.operatorColor || "#0284c7";

  const overallStatus = getStationOverallStatus(station);
  if (overallStatus === "available") {
    statusBadge.className = "px-2 py-0.5 rounded-md text-[11px] font-medium flex items-center gap-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30";
    statusBadge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> ว่างพร้อมชาร์จ`;
  } else if (overallStatus === "occupied") {
    statusBadge.className = "px-2 py-0.5 rounded-md text-[11px] font-medium flex items-center gap-1 bg-amber-500/20 text-amber-400 border border-amber-500/30";
    statusBadge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span> กำลังใช้งานเต็ม`;
  } else {
    statusBadge.className = "px-2 py-0.5 rounded-md text-[11px] font-medium flex items-center gap-1 bg-rose-500/20 text-rose-400 border border-rose-500/30";
    statusBadge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-rose-400"></span> ปิดปรับปรุง`;
  }

  addressEl.textContent = station.address;
  coordsEl.textContent = `${station.coordinates.lat.toFixed(4)}, ${station.coordinates.lng.toFixed(4)}`;

  const distanceKm = calculateDistanceKm(
    state.userLocation.lat, state.userLocation.lng,
    station.coordinates.lat, station.coordinates.lng
  );
  distEl.innerHTML = `<i data-lucide="navigation" class="w-3 h-3"></i> ห่างจากคุณ ~${distanceKm} กม.`;

  // Render Connector Cards
  connectorsList.innerHTML = "";
  connCountEl.textContent = `${station.connectors.length} หัวชาร์จ`;

  station.connectors.forEach((conn, index) => {
    const card = document.createElement("div");
    const isAvail = conn.status === "available";
    const isOccupied = conn.status === "occupied";
    
    card.className = `p-3 rounded-xl border flex items-center justify-between gap-3 ${
      isAvail ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-100' : 
      isOccupied ? 'bg-amber-950/30 border-amber-500/40 text-amber-100' : 
      'bg-rose-950/30 border-rose-500/40 text-rose-100'
    }`;

    card.innerHTML = `
      <div class="flex items-center gap-2.5">
        <div class="w-9 h-9 rounded-lg flex items-center justify-center text-white ${
          isAvail ? 'bg-emerald-600' : isOccupied ? 'bg-amber-600' : 'bg-rose-600'
        } font-bold text-xs shadow-md">
          ${conn.type === 'CCS2' ? 'CCS2' : conn.type === 'Type 2' ? 'Type2' : 'CHA'}
        </div>
        <div>
          <div class="flex items-center gap-2">
            <span class="font-bold text-white text-xs">พอร์ต ${index + 1}: ${conn.type}</span>
            <span class="text-[10px] px-1.5 py-0.2 rounded font-mono font-bold ${
              conn.powerKW >= 120 ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' :
              conn.powerKW >= 50 ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
              'bg-sky-500/20 text-sky-400 border border-sky-500/30'
            }">${conn.powerKW} kW</span>
          </div>
          <div class="text-[11px] mt-0.5 flex items-center gap-1.5 ${
            isAvail ? 'text-emerald-400' : isOccupied ? 'text-amber-400' : 'text-rose-400'
          }">
            <span class="w-2 h-2 rounded-full ${isAvail ? 'bg-emerald-400' : isOccupied ? 'bg-amber-400' : 'bg-rose-400'}"></span>
            <span>${isAvail ? 'ว่างพร้อมเสียบชาร์จ' : isOccupied ? `มีรถกำลังชาร์จ (${conn.currentVehicle || 'EV'})` : 'ปิดปรับปรุง'}</span>
          </div>
        </div>
      </div>
      <button class="btn-toggle-port px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] border border-slate-700 whitespace-nowrap" data-conn-id="${conn.id}" title="สลับสถานะเพื่อจำลอง">
        เปลี่ยนสถานะ
      </button>
    `;

    // Toggle Port status button handler
    card.querySelector(".btn-toggle-port").addEventListener("click", () => {
      const nextStatus = isAvail ? "occupied" : isOccupied ? "offline" : "available";
      updateStationConnectorStatus(station.id, conn.id, nextStatus);
      showToast(`อัปเดตสถานะ ${conn.type} ช่อง ${index + 1} เป็น: ${nextStatus === 'available' ? 'ว่าง' : nextStatus === 'occupied' ? 'กำลังชาร์จ' : 'ปิดปรับปรุง'}`, "success");
    });

    connectorsList.appendChild(card);
  });

  // Render Pricing
  document.getElementById("drawer-price-onpeak").innerHTML = `${station.pricing.onPeak.toFixed(2)} <span class="text-xs font-normal text-slate-400">บาท</span>`;
  document.getElementById("drawer-price-offpeak").innerHTML = `${station.pricing.offPeak.toFixed(2)} <span class="text-xs font-normal text-slate-400">บาท</span>`;
  document.getElementById("drawer-parking-fee").textContent = `ที่จอดรถ: ${station.pricing.parkingFee || "จอดฟรีตลอดการชาร์จ"}`;

  // Amenities
  amenitiesList.innerHTML = "";
  const amenitiesBadges = station.amenitiesText || ["เปิด 24 ชม.", "ร้านกาแฟ", "ห้องน้ำ"];
  amenitiesBadges.forEach(item => {
    const badge = document.createElement("span");
    badge.className = "px-2.5 py-1 rounded-xl bg-slate-800 text-slate-300 text-[11px] border border-slate-700/80 flex items-center gap-1";
    badge.innerHTML = `<i data-lucide="check" class="w-3 h-3 text-emerald-400"></i> ${item}`;
    amenitiesList.appendChild(badge);
  });

  // Reviews & Check-ins
  reviewsList.innerHTML = "";
  const reviews = station.reviews || [];
  reviewsCountEl.textContent = `${reviews.length} รีวิว`;
  if (reviews.length === 0) {
    reviewsList.innerHTML = `<p class="text-slate-500 text-xs py-2 text-center">ยังไม่มีรีวิว ร่วมเป็นคนแรกที่เช็กอินสถานีนี้!</p>`;
  } else {
    reviews.forEach(rev => {
      const revItem = document.createElement("div");
      revItem.className = "p-2.5 bg-slate-800/60 rounded-xl border border-slate-800 text-xs space-y-1";
      revItem.innerHTML = `
        <div class="flex items-center justify-between text-[11px]">
          <span class="font-bold text-slate-200">${rev.user}</span>
          <span class="text-slate-500">${rev.time || 'เมื่อสักครู่'}</span>
        </div>
        <p class="text-slate-300 text-[11px]">${rev.comment}</p>
        ${rev.waitTime ? `<span class="inline-block text-[10px] px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">รอคิว: ${rev.waitTime}</span>` : ''}
      `;
      reviewsList.appendChild(revItem);
    });
  }

  if (window.lucide) window.lucide.createIcons();
}

// Close Station Drawer
function closeStationDrawer() {
  const drawer = document.getElementById("station-drawer");
  if (drawer) {
    drawer.classList.add("translate-y-full", "md:translate-x-full");
  }
}

// Comprehensive Filtering Logic
function applyFilters() {
  const query = state.filters.searchQuery.toLowerCase().trim();

  state.filteredStations = state.stations.filter(station => {
    // Search query match
    if (query) {
      const matchName = station.name.toLowerCase().includes(query);
      const matchNameEn = (station.nameEn || "").toLowerCase().includes(query);
      const matchAddress = station.address.toLowerCase().includes(query);
      const matchOperator = station.operator.toLowerCase().includes(query);
      if (!matchName && !matchNameEn && !matchAddress && !matchOperator) {
        return false;
      }
    }

    // Operator filter
    if (state.filters.operator !== "all" && station.operator !== state.filters.operator) {
      return false;
    }

    // Availability filter
    const overallStatus = getStationOverallStatus(station);
    if (state.filters.onlyAvailable && overallStatus !== "available") {
      return false;
    }

    // Speed filter: 'dc' (>= 50kW), 'ultra' (>= 120kW)
    if (state.filters.speed === "dc") {
      const hasDC = station.connectors.some(c => c.powerKW >= 50);
      if (!hasDC) return false;
    } else if (state.filters.speed === "ultra") {
      const hasUltra = station.connectors.some(c => c.powerKW >= 120);
      if (!hasUltra) return false;
    }

    // Connector type filter
    if (state.filters.connectors.size > 0) {
      const hasSelectedType = station.connectors.some(c => state.filters.connectors.has(c.type));
      if (!hasSelectedType) return false;
    }

    return true;
  });

  updateMapMarkers();
  updateMapSummaryCounts();
}

function updateMapSummaryCounts() {
  const totalEl = document.getElementById("stat-total-count");
  const availEl = document.getElementById("stat-available-count");
  const occEl = document.getElementById("stat-occupied-count");

  let availableCount = 0;
  let occupiedCount = 0;

  state.filteredStations.forEach(s => {
    const st = getStationOverallStatus(s);
    if (st === "available") availableCount++;
    else if (st === "occupied") occupiedCount++;
  });

  if (totalEl) totalEl.textContent = state.filteredStations.length;
  if (availEl) availEl.textContent = availableCount;
  if (occEl) occEl.textContent = occupiedCount;
}

function updateTOUDisplay() {
  const status = getThailandTOUStatus();
  const textEl = document.getElementById("tou-status-text");
  const dotEl = document.getElementById("tou-indicator-dot");
  const drawerPill = document.getElementById("drawer-current-tariff-pill");

  if (textEl) textEl.textContent = status.text;
  if (dotEl) {
    dotEl.className = `w-2 h-2 rounded-full animate-ping ${status.isOnPeak ? 'bg-amber-400' : 'bg-emerald-400'}`;
  }
  if (drawerPill) {
    drawerPill.className = `text-[10px] px-2 py-0.5 rounded-full font-semibold border ${status.badgeClass}`;
    drawerPill.textContent = status.isOnPeak ? "ขณะนี้ On-Peak" : "ขณะนี้ Off-Peak";
  }
}

// Intelligent EV Route & Trip Planner Algorithm
export function calculateEVTrip() {
  const origin = state.planner.origin;
  const dest = state.planner.destination;
  const batteryCap = state.planner.batteryCapacity;
  const currentSoc = state.planner.currentSoc;
  const consumptionRate = state.planner.consumptionRate; // km/kWh
  const targetArrivalSoc = state.planner.targetArrivalSoc;

  // Direct distance calculation between Origin and Destination
  const totalDistance = calculateDistanceKm(origin.lat, origin.lng, dest.lat, dest.lng);
  // Estimated driving duration (assuming average speed 85 km/h on highway)
  const durationHours = totalDistance / 85;
  const hours = Math.floor(durationHours);
  const minutes = Math.round((durationHours - hours) * 60);

  // Battery Energy Required for trip: Energy (kWh) = Distance / Rate
  const energyRequired = totalDistance / consumptionRate;
  const socDepleted = (energyRequired / batteryCap) * 100;
  const projectedArrivalSoc = Math.round(currentSoc - socDepleted);

  const needStop = projectedArrivalSoc < targetArrivalSoc || projectedArrivalSoc <= 15;

  let suggestedStopStation = null;
  let chargingTimeMins = 0;
  let estimatedCost = 0;

  if (needStop) {
    // Find suitable DC Fast Charger (>= 50kW) along the corridor
    // We score stations by their distance along the corridor and power rating
    const candidates = state.stations.filter(s => {
      const hasFast = s.connectors.some(c => c.powerKW >= 50 && c.status !== "offline");
      return hasFast;
    });

    // Score candidates by midpoint distance
    let bestScore = Infinity;
    candidates.forEach(cand => {
      const distFromOrigin = calculateDistanceKm(origin.lat, origin.lng, cand.coordinates.lat, cand.coordinates.lng);
      const distToDest = calculateDistanceKm(cand.coordinates.lat, cand.coordinates.lng, dest.lat, dest.lng);
      const totalDetour = (distFromOrigin + distToDest) - totalDistance;

      // Ensure station is reachable with current battery (need to reach it with > 10% SoC)
      const energyToStation = distFromOrigin / consumptionRate;
      const socAtStation = currentSoc - (energyToStation / batteryCap * 100);

      if (socAtStation > 8 && totalDetour < 35) {
        if (totalDetour < bestScore) {
          bestScore = totalDetour;
          suggestedStopStation = cand;
        }
      }
    });

    // Fallback to highest power station on route if strictly matched none
    if (!suggestedStopStation && candidates.length > 0) {
      suggestedStopStation = candidates[0];
    }

    if (suggestedStopStation) {
      // Calculate charging time to reach 80% SoC
      const distToStop = calculateDistanceKm(origin.lat, origin.lng, suggestedStopStation.coordinates.lat, suggestedStopStation.coordinates.lng);
      const socAtStation = Math.max(Math.round(currentSoc - (distToStop / consumptionRate / batteryCap * 100)), 10);
      const socToCharge = Math.max(80 - socAtStation, 20);
      const energyToCharge = (socToCharge / 100) * batteryCap;

      // Get maximum DC power from this station
      const maxKW = Math.max(...suggestedStopStation.connectors.map(c => c.powerKW));
      const effectiveKW = Math.min(maxKW, 150); // vehicle fast charge limit
      chargingTimeMins = Math.round((energyToCharge / effectiveKW) * 60);

      // Calculate cost using current TOU rate
      const tou = getThailandTOUStatus();
      const rate = tou.isOnPeak ? suggestedStopStation.pricing.onPeak : suggestedStopStation.pricing.offPeak;
      estimatedCost = Math.round(energyToCharge * rate);
    }
  }

  state.routeResult = {
    totalDistance,
    durationText: `${hours > 0 ? hours + ' ชม. ' : ''}${minutes} นาที`,
    projectedArrivalSoc,
    needStop,
    energyRequired: Math.round(energyRequired * 10) / 10,
    suggestedStop: suggestedStopStation,
    chargingTimeMins,
    estimatedCost
  };
  state.suggestedStop = suggestedStopStation;

  // Render Route Results UI
  renderRouteResults();

  // Draw Route on Map
  plotRouteOnMap(origin, dest, suggestedStopStation);
}

function renderRouteResults() {
  const resContainer = document.getElementById("route-results-container");
  const distEl = document.getElementById("result-distance");
  const durEl = document.getElementById("result-duration");
  const socEl = document.getElementById("result-arrival-soc");
  const stopBadge = document.getElementById("result-need-stop-badge");
  const depletionText = document.getElementById("result-depletion-text");
  const barRemaining = document.getElementById("bar-soc-remaining");
  const cardStop = document.getElementById("card-suggested-stop");

  if (!resContainer || !state.routeResult) return;

  const res = state.routeResult;
  resContainer.classList.remove("hidden");

  distEl.textContent = `${res.totalDistance} กม.`;
  durEl.textContent = res.durationText;

  if (res.projectedArrivalSoc < 15) {
    socEl.textContent = `${res.projectedArrivalSoc}% ⚠️`;
    socEl.className = "text-sm font-bold text-rose-400 mt-0.5";
  } else if (res.projectedArrivalSoc < state.planner.targetArrivalSoc) {
    socEl.textContent = `${res.projectedArrivalSoc}% ⚡`;
    socEl.className = "text-sm font-bold text-amber-400 mt-0.5";
  } else {
    socEl.textContent = `${res.projectedArrivalSoc}% ✅`;
    socEl.className = "text-sm font-bold text-emerald-400 mt-0.5";
  }

  if (res.needStop) {
    stopBadge.textContent = "ต้องแวะชาร์จ 1 จุด";
    stopBadge.className = "px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30";
    cardStop.classList.remove("hidden");

    if (res.suggestedStop) {
      document.getElementById("stop-station-name").textContent = res.suggestedStop.name;
      document.getElementById("stop-operator-pill").textContent = res.suggestedStop.operator;
      document.getElementById("stop-details-text").textContent = 
        `ที่ตั้ง: ${res.suggestedStop.address.substring(0, 45)}... | กำลังไฟสูงสุด: ${Math.max(...res.suggestedStop.connectors.map(c => c.powerKW))} kW`;
      document.getElementById("stop-charging-time").textContent = `~${res.chargingTimeMins} นาที (ถึง 80%)`;
      document.getElementById("stop-estimated-cost").textContent = `~${res.estimatedCost} บาท`;
    }
  } else {
    stopBadge.textContent = "แบตฯ เพียงพอตลอดเส้นทาง";
    stopBadge.className = "px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30";
    cardStop.classList.add("hidden");
  }

  depletionText.textContent = `ใช้พลังงาน ${res.energyRequired} kWh (~${Math.round(state.planner.currentSoc - res.projectedArrivalSoc)}%)`;
  const barWidth = Math.max(Math.min(res.projectedArrivalSoc, 100), 0);
  barRemaining.style.width = `${barWidth}%`;
  barRemaining.className = `h-full rounded-full transition-all duration-500 ${
    barWidth < 15 ? 'bg-rose-500' : barWidth < 30 ? 'bg-amber-500' : 'bg-emerald-500'
  }`;

  if (window.lucide) window.lucide.createIcons();
}

function plotRouteOnMap(origin, dest, waypointStop) {
  if (state.isGoogleMapsLoaded && state.directionsService && state.directionsRenderer) {
    const waypoints = [];
    if (waypointStop) {
      waypoints.push({
        location: new google.maps.LatLng(waypointStop.coordinates.lat, waypointStop.coordinates.lng),
        stopover: true
      });
    }

    state.directionsService.route(
      {
        origin: new google.maps.LatLng(origin.lat, origin.lng),
        destination: new google.maps.LatLng(dest.lat, dest.lng),
        waypoints: waypoints,
        travelMode: google.maps.TravelMode.DRIVING
      },
      (response, status) => {
        if (status === "OK") {
          state.directionsRenderer.setDirections(response);
          showToast("คำนวณเส้นทางและจุดแวะสำเร็จ!", "success");
        } else {
          console.warn("Directions request failed:", status);
          showToast("คำนวณเส้นทางสำเร็จ (แสดงผลแนวเส้นทางจำลอง)", "info");
        }
      }
    );
  } else {
    // Redraw vector canvas map with the newly calculated corridor
    drawVectorMap();
    showToast("คำนวณเส้นทางและจุดแวะชาร์จสำเร็จ!", "success");
  }
}

// Setup UI Event Listeners
function setupEventListeners() {
  // Search Bar Input
  const searchInput = document.getElementById("search-input");
  const clearSearchBtn = document.getElementById("clear-search-btn");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      state.filters.searchQuery = e.target.value;
      if (e.target.value) {
        clearSearchBtn?.classList.remove("hidden");
      } else {
        clearSearchBtn?.classList.add("hidden");
      }
      applyFilters();
    });
  }

  if (clearSearchBtn) {
    clearSearchBtn.addEventListener("click", () => {
      if (searchInput) searchInput.value = "";
      state.filters.searchQuery = "";
      clearSearchBtn.classList.add("hidden");
      applyFilters();
    });
  }

  // Filter Pills
  document.querySelectorAll(".filter-pill").forEach(pill => {
    pill.addEventListener("click", () => {
      const type = pill.dataset.filter;
      if (type === "available") {
        state.filters.onlyAvailable = !state.filters.onlyAvailable;
        pill.classList.toggle("bg-emerald-600/30", state.filters.onlyAvailable);
        pill.classList.toggle("border-emerald-500", state.filters.onlyAvailable);
      } else if (type === "speed-dc") {
        state.filters.speed = state.filters.speed === "dc" ? "all" : "dc";
        pill.classList.toggle("bg-amber-600/30", state.filters.speed === "dc");
        pill.classList.toggle("border-amber-500", state.filters.speed === "dc");
        document.getElementById("filter-ultra-fast")?.classList.remove("bg-rose-600/30", "border-rose-500");
      } else if (type === "speed-ultra") {
        state.filters.speed = state.filters.speed === "ultra" ? "all" : "ultra";
        pill.classList.toggle("bg-rose-600/30", state.filters.speed === "ultra");
        pill.classList.toggle("border-rose-500", state.filters.speed === "ultra");
        document.getElementById("filter-dc-fast")?.classList.remove("bg-amber-600/30", "border-amber-500");
      } else if (type === "conn-ccs2") {
        toggleConnectorFilter("CCS2", pill);
      } else if (type === "conn-type2") {
        toggleConnectorFilter("Type 2", pill);
      } else if (type === "conn-chademo") {
        toggleConnectorFilter("CHAdeMO", pill);
      }
      applyFilters();
    });
  });

  function toggleConnectorFilter(connType, el) {
    if (state.filters.connectors.has(connType)) {
      state.filters.connectors.delete(connType);
      el.classList.remove("bg-sky-600/30", "border-sky-500");
    } else {
      state.filters.connectors.add(connType);
      el.classList.add("bg-sky-600/30", "border-sky-500");
    }
  }

  // Operator Filter Dropdown
  const opSelect = document.getElementById("filter-operator");
  if (opSelect) {
    opSelect.addEventListener("change", (e) => {
      state.filters.operator = e.target.value;
      applyFilters();
    });
  }

  // Reset Filters Button
  document.getElementById("btn-reset-filters")?.addEventListener("click", () => {
    state.filters = {
      searchQuery: "",
      onlyAvailable: false,
      speed: "all",
      connectors: new Set(),
      operator: "all"
    };
    if (searchInput) searchInput.value = "";
    if (opSelect) opSelect.value = "all";
    document.querySelectorAll(".filter-pill").forEach(p => {
      p.classList.remove("bg-emerald-600/30", "border-emerald-500", "bg-amber-600/30", "border-amber-500", "bg-rose-600/30", "border-rose-500", "bg-sky-600/30", "border-sky-500");
    });
    applyFilters();
    showToast("ล้างตัวกรองทั้งหมดเรียบร้อย", "info");
  });

  // Drawer Close Button & Drag Handle
  document.getElementById("drawer-close-btn")?.addEventListener("click", closeStationDrawer);
  document.getElementById("drawer-drag-handle")?.addEventListener("click", closeStationDrawer);

  // FABs: My Location & Fit Bounds
  document.getElementById("fab-location")?.addEventListener("click", () => {
    acquireUserLocation();
    if (state.isGoogleMapsLoaded && state.googleMap) {
      state.googleMap.panTo(state.userLocation);
      state.googleMap.setZoom(13);
    } else {
      canvasMap.scale = 1.3;
      drawVectorMap();
    }
    showToast("กลับสู่ตำแหน่งปัจจุบันของคุณ", "info");
  });

  document.getElementById("fab-fit-bounds")?.addEventListener("click", () => {
    if (state.isGoogleMapsLoaded && state.googleMap) {
      const bounds = new google.maps.LatLngBounds();
      state.stations.forEach(s => bounds.extend(s.coordinates));
      state.googleMap.fitBounds(bounds);
    } else {
      canvasMap.scale = 1;
      canvasMap.offsetX = 0;
      canvasMap.offsetY = 0;
      drawVectorMap();
    }
    showToast("แสดงภาพรวมสถานีทั่วไทย", "info");
  });

  // Trip Planner Drawer Controls
  const plannerPanel = document.getElementById("trip-planner-panel");
  document.getElementById("btn-open-trip-planner")?.addEventListener("click", () => {
    plannerPanel?.classList.remove("-translate-x-full");
  });
  document.getElementById("trip-planner-close-btn")?.addEventListener("click", () => {
    plannerPanel?.classList.add("-translate-x-full");
  });

  // Quick Destination Chips
  document.querySelectorAll(".quick-dest-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const destName = chip.dataset.dest;
      const input = document.getElementById("route-dest-input");
      if (input) input.value = destName;
      if (POPULAR_DESTINATIONS[destName]) {
        state.planner.destination = POPULAR_DESTINATIONS[destName];
      }
    });
  });

  // Vehicle Preset Selection
  const vehicleSelect = document.getElementById("vehicle-preset-select");
  if (vehicleSelect) {
    vehicleSelect.addEventListener("change", (e) => {
      const preset = VEHICLE_PRESETS[e.target.value];
      if (preset) {
        document.getElementById("input-battery-capacity").value = preset.capacity;
        document.getElementById("input-consumption-rate").value = preset.rate;
        state.planner.batteryCapacity = preset.capacity;
        state.planner.consumptionRate = preset.rate;
      }
    });
  }

  // Battery Sliders
  const socSlider = document.getElementById("slider-current-soc");
  const targetSocSlider = document.getElementById("slider-target-soc");
  if (socSlider) {
    socSlider.addEventListener("input", (e) => {
      document.getElementById("label-current-soc").textContent = `${e.target.value}%`;
      state.planner.currentSoc = parseFloat(e.target.value);
    });
  }
  if (targetSocSlider) {
    targetSocSlider.addEventListener("input", (e) => {
      document.getElementById("label-target-soc").textContent = `${e.target.value}%`;
      state.planner.targetArrivalSoc = parseFloat(e.target.value);
    });
  }

  // Calculate Route Button
  document.getElementById("btn-calculate-route")?.addEventListener("click", () => {
    const destInput = document.getElementById("route-dest-input")?.value || "";
    if (POPULAR_DESTINATIONS[destInput]) {
      state.planner.destination = POPULAR_DESTINATIONS[destInput];
    } else {
      state.planner.destination = {
        name: destInput,
        lat: 14.6852,
        lng: 101.4085 // fallback coordinates
      };
    }

    state.planner.batteryCapacity = parseFloat(document.getElementById("input-battery-capacity").value) || 60.5;
    state.planner.consumptionRate = parseFloat(document.getElementById("input-consumption-rate").value) || 6.2;
    state.planner.currentSoc = parseFloat(socSlider.value) || 65;
    state.planner.targetArrivalSoc = parseFloat(targetSocSlider.value) || 20;

    calculateEVTrip();
  });

  // Clear Route Button
  document.getElementById("btn-clear-route")?.addEventListener("click", () => {
    state.routeResult = null;
    state.suggestedStop = null;
    document.getElementById("route-results-container")?.classList.add("hidden");
    if (state.directionsRenderer) {
      state.directionsRenderer.set("directions", null);
    }
    drawVectorMap();
    showToast("ล้างเส้นทางแล้ว", "info");
  });

  // Apply suggested stop to Map
  document.getElementById("btn-apply-stop-to-map")?.addEventListener("click", () => {
    if (state.suggestedStop) {
      selectStation(state.suggestedStop);
      plannerPanel?.classList.add("-translate-x-full");
    }
  });

  // Simulation Toggle Button
  const simBtn = document.getElementById("btn-toggle-simulation");
  const simBadge = document.getElementById("simulation-badge");
  if (simBtn) {
    simBtn.addEventListener("click", () => {
      const active = toggleRealtimeSimulation((change) => {
        showToast(`⚡ [Realtime] ${change.station.name}: หัวชาร์จ ${change.connector.type} สถานะเป็น "${change.status === 'available' ? 'ว่าง' : 'กำลังชาร์จ (' + (change.connector.currentVehicle || 'EV') + ')'}"`, "info");
      });
      state.isSimulationActive = active;
      if (active) {
        simBadge.className = "w-2 h-2 rounded-full bg-emerald-400 animate-pulse";
        simBtn.classList.add("border-emerald-500");
        showToast("เปิดโหมดจำลอง Real-Time: สุ่มเปลี่ยนสถานะหัวชาร์จทุก 4.5 วินาที", "success");
      } else {
        simBadge.className = "w-2 h-2 rounded-full bg-slate-500";
        simBtn.classList.remove("border-emerald-500");
        showToast("ปิดโหมดจำลอง Real-Time", "info");
      }
    });
  }

  // Tariff Info Modal
  const tariffModal = document.getElementById("modal-tariff");
  document.getElementById("btn-open-tariff")?.addEventListener("click", () => {
    tariffModal?.classList.remove("hidden");
    tariffModal?.classList.add("flex");
  });
  document.getElementById("modal-tariff-close")?.addEventListener("click", () => {
    tariffModal?.classList.add("hidden");
    tariffModal?.classList.remove("flex");
  });
  document.getElementById("tou-live-pill")?.addEventListener("click", () => {
    tariffModal?.classList.remove("hidden");
    tariffModal?.classList.add("flex");
  });

  // Settings Modal
  const settingsModal = document.getElementById("modal-settings");
  document.getElementById("btn-open-settings")?.addEventListener("click", () => {
    settingsModal?.classList.remove("hidden");
    settingsModal?.classList.add("flex");
    const keyInput = document.getElementById("input-gmp-key");
    if (keyInput) keyInput.value = localStorage.getItem("gmp_api_key") || "";
  });
  document.getElementById("modal-settings-close")?.addEventListener("click", () => {
    settingsModal?.classList.add("hidden");
    settingsModal?.classList.remove("flex");
  });

  document.getElementById("btn-save-gmp-key")?.addEventListener("click", () => {
    const key = document.getElementById("input-gmp-key")?.value?.trim();
    if (key) {
      localStorage.setItem("gmp_api_key", key);
      showToast("บันทึก Google Maps API Key สำเร็จ! กำลังโหลดแผนที่...", "success");
      setupMapsPlatform();
    } else {
      localStorage.removeItem("gmp_api_key");
      showToast("ล้าง API Key เรียบร้อย (ใช้โหมดจำลอง)", "info");
    }
    settingsModal?.classList.add("hidden");
    settingsModal?.classList.remove("flex");
  });

  document.getElementById("btn-reset-default-data")?.addEventListener("click", () => {
    localStore.resetToDefault();
    showToast("รีเซ็ตสถานีชาร์จกลับสู่ค่าเริ่มต้นเรียบร้อย", "success");
    settingsModal?.classList.add("hidden");
    settingsModal?.classList.remove("flex");
  });

  // Crowdsourced Check-In Modal
  const checkinModal = document.getElementById("modal-checkin");
  let checkinStatusChoice = "available";

  document.getElementById("drawer-btn-checkin")?.addEventListener("click", () => {
    if (!state.selectedStation) return;
    document.getElementById("modal-checkin-station-name").textContent = state.selectedStation.name;
    checkinModal?.classList.remove("hidden");
    checkinModal?.classList.add("flex");
  });

  document.getElementById("modal-checkin-close")?.addEventListener("click", () => {
    checkinModal?.classList.add("hidden");
    checkinModal?.classList.remove("flex");
  });

  document.querySelectorAll(".btn-checkin-status").forEach(btn => {
    btn.addEventListener("click", () => {
      checkinStatusChoice = btn.dataset.status;
      document.querySelectorAll(".btn-checkin-status").forEach(b => {
        b.classList.remove("border-emerald-500/50", "bg-emerald-500/20", "text-emerald-300", "border-amber-500/50", "bg-amber-500/20", "text-amber-300", "border-rose-500/50", "bg-rose-500/20", "text-rose-300");
        b.classList.add("border-slate-700", "bg-slate-800", "text-slate-300");
      });
      if (checkinStatusChoice === "available") {
        btn.className = "btn-checkin-status p-2.5 rounded-xl border border-emerald-500/50 bg-emerald-500/20 text-emerald-300 font-medium flex flex-col items-center gap-1";
      } else if (checkinStatusChoice === "occupied") {
        btn.className = "btn-checkin-status p-2.5 rounded-xl border border-amber-500/50 bg-amber-500/20 text-amber-300 font-medium flex flex-col items-center gap-1";
      } else {
        btn.className = "btn-checkin-status p-2.5 rounded-xl border border-rose-500/50 bg-rose-500/20 text-rose-300 font-medium flex flex-col items-center gap-1";
      }
    });
  });

  document.getElementById("btn-submit-checkin")?.addEventListener("click", () => {
    if (!state.selectedStation) return;
    const comment = document.getElementById("checkin-comment")?.value || "ยืนยันสถานะหัวชาร์จพร้อมใช้งาน";
    const waitTime = document.getElementById("checkin-wait-time")?.value || "ไม่ต้องรอ";

    addStationCheckIn(state.selectedStation.id, {
      status: checkinStatusChoice,
      comment: comment,
      waitTime: waitTime,
      rating: 5,
      userName: "ผู้ใช้ EV ประเทศไทย"
    });

    // Update first connector status to match report
    if (state.selectedStation.connectors && state.selectedStation.connectors.length > 0) {
      updateStationConnectorStatus(state.selectedStation.id, state.selectedStation.connectors[0].id, checkinStatusChoice);
    }

    checkinModal?.classList.add("hidden");
    checkinModal?.classList.remove("flex");
    showToast("ส่งข้อมูลเช็กอินสำเร็จ ขอบคุณที่ร่วมอัปเดตข้อมูลให้กับเพื่อนผู้ใช้ EV!", "success");
    document.getElementById("checkin-comment").value = "";
  });

  // Navigate Button: Open directions in Google Maps external app/web
  document.getElementById("drawer-btn-navigate")?.addEventListener("click", () => {
    if (!state.selectedStation) return;
    const { lat, lng } = state.selectedStation.coordinates;
    const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
    window.open(url, "_blank");
  });

  // Add Stop Button: Set as waypoint in trip planner
  document.getElementById("drawer-btn-add-stop")?.addEventListener("click", () => {
    if (!state.selectedStation) return;
    state.planner.destination = {
      name: state.selectedStation.name,
      lat: state.selectedStation.coordinates.lat,
      lng: state.selectedStation.coordinates.lng
    };
    const destInput = document.getElementById("route-dest-input");
    if (destInput) destInput.value = state.selectedStation.name;
    closeStationDrawer();
    plannerPanel?.classList.remove("-translate-x-full");
    showToast(`เพิ่ม ${state.selectedStation.name} เป็นปลายทางในแผนเดินทางแล้ว`, "success");
  });
}

// Start application when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
