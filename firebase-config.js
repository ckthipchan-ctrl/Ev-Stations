/**
 * firebase-config.js
 * Production-ready Firebase Web SDK v10+ Modular Initialization
 * EV Charging Station Finder & Trip Planner (Thailand)
 */

import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp
} from "firebase/firestore";
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "firebase/auth";

// Environment constants for Firebase Project Configuration (alert-diorama-g40ks)
export const firebaseConfig = {
  apiKey: import.meta.env?.VITE_FIREBASE_API_KEY || "AIzaSyCq-cj3OWhkO7QhCMt8RwzOknk1G7jttd4",
  authDomain: import.meta.env?.VITE_FIREBASE_AUTH_DOMAIN || "alert-diorama-g40ks.firebaseapp.com",
  projectId: import.meta.env?.VITE_FIREBASE_PROJECT_ID || "alert-diorama-g40ks",
  firestoreDatabaseId: "ai-studio-evchargingstatio-bc511205-b4db-4369-b94f-1ee52ce051f9",
  storageBucket: import.meta.env?.VITE_FIREBASE_STORAGE_BUCKET || "alert-diorama-g40ks.firebasestorage.app",
  messagingSenderId: import.meta.env?.VITE_FIREBASE_MESSAGING_SENDER_ID || "268179263000",
  appId: import.meta.env?.VITE_FIREBASE_APP_ID || "1:268179263000:web:69bf1086ef394a47e8bd6d"
};

// Check if actual valid Firebase credentials are provided
export const isConfigValid = () => {
  return (
    firebaseConfig.apiKey &&
    !firebaseConfig.apiKey.includes("PLACEHOLDER") &&
    firebaseConfig.projectId &&
    !firebaseConfig.projectId.includes("PLACEHOLDER")
  );
};

// Initialize Firebase App
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = firebaseConfig.firestoreDatabaseId 
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId) 
  : getFirestore(app);

// Realistic Thailand EV Charging Stations dataset (with On-Peak / Off-Peak rates)
export const INITIAL_THAI_STATIONS = [
  {
    id: "ptt-vibhavadi-km11",
    name: "PTT Station วิภาวดีรังสิต กม.11",
    nameEn: "PTT Station Vibhavadi KM 11",
    operator: "PTT EV Station PluZ",
    operatorColor: "#0284c7", // Blue
    coordinates: { lat: 13.8242, lng: 100.5601 },
    address: "ถนนวิภาวดีรังสิต แขวงจตุจักร เขตจตุจักร กรุงเทพฯ 10900",
    connectors: [
      { id: "c1", type: "CCS2", powerKW: 120, status: "available" },
      { id: "c2", type: "CCS2", powerKW: 120, status: "occupied", currentVehicle: "BYD Atto 3" },
      { id: "c3", type: "Type 2", powerKW: 22, status: "available" }
    ],
    pricing: {
      onPeak: 7.70,
      offPeak: 6.00,
      unit: "บาท/kWh",
      peakHours: "จ.-ศ. 09:00 - 22:00 น.",
      offPeakHours: "จ.-ศ. 22:00 - 09:00 น. และ ส.-อา. / วันหยุดราชการ ตลอด 24 ชม.",
      parkingFee: "จอดฟรีตลอดการชาร์จ"
    },
    amenities: ["24_hours", "cafe", "convenience_store", "restroom", "restaurant"],
    amenitiesText: ["เปิด 24 ชม.", "Café Amazon", "7-Eleven", "ห้องน้ำสะอาด", "ร้านอาหาร"],
    reviews: [
      { id: "r1", user: "สมชาย ขับอีวี", rating: 5, time: "10 นาทีที่แล้ว", comment: "หัว CCS2 120kW ยิงไฟแรงมาก เข้า 115kW เต็มสปีด" }
    ],
    updatedAt: new Date().toISOString()
  },
  {
    id: "pea-ayutthaya-bypass",
    name: "PEA VOLTA จุดพักรถสายเอเชีย อยุธยาบายพาส",
    nameEn: "PEA VOLTA Ayutthaya Bypass",
    operator: "PEA VOLTA",
    operatorColor: "#9333ea", // Purple
    coordinates: { lat: 14.3412, lng: 100.5985 },
    address: "ทางหลวงหมายเลข 32 ต.คลองสวนพลู อ.พระนครศรีอยุธยา จ.พระนครศรีอยุธยา",
    connectors: [
      { id: "c1", type: "CCS2", powerKW: 160, status: "occupied", currentVehicle: "Tesla Model Y" },
      { id: "c2", type: "CCS2", powerKW: 160, status: "available" },
      { id: "c3", type: "CHAdeMO", powerKW: 50, status: "available" }
    ],
    pricing: {
      onPeak: 7.50,
      offPeak: 5.30,
      unit: "บาท/kWh",
      peakHours: "จ.-ศ. 09:00 - 22:00 น.",
      offPeakHours: "จ.-ศ. 22:00 - 09:00 น. และ ส.-อา. / วันหยุดราชการ ตลอด 24 ชม.",
      parkingFee: "ฟรีไม่มีค่าจอด"
    },
    amenities: ["24_hours", "convenience_store", "restroom", "cafe"],
    amenitiesText: ["เปิด 24 ชม.", "มินิมาร์ท", "ห้องน้ำ กฟภ.", "ร้านกาแฟ"],
    reviews: [
      { id: "r2", user: "เอกลักษณ์ ก.", rating: 4.5, time: "45 นาทีที่แล้ว", comment: "ตู้ 160kW ใช้งานได้สะดวก แอพ PEA สแกนติดง่าย" }
    ],
    updatedAt: new Date().toISOString()
  },
  {
    id: "ea-central-world",
    name: "EA Anywhere เซ็นทรัลเวิลด์ (ชั้น B1)",
    nameEn: "EA Anywhere Central World",
    operator: "EA Anywhere",
    operatorColor: "#16a34a", // Green
    coordinates: { lat: 13.7468, lng: 100.5393 },
    address: "ศูนย์การค้าเซ็นทรัลเวิลด์ ถ.พระราม 1 แขวงปทุมวัน เขตปทุมวัน กรุงเทพฯ",
    connectors: [
      { id: "c1", type: "CCS2", powerKW: 150, status: "available" },
      { id: "c2", type: "CCS2", powerKW: 150, status: "occupied", currentVehicle: "Porsche Taycan" },
      { id: "c3", type: "Type 2", powerKW: 43, status: "available" }
    ],
    pricing: {
      onPeak: 7.70,
      offPeak: 6.50,
      unit: "บาท/kWh",
      peakHours: "ตามเวลาศูนย์การค้า 10:00 - 22:00 น.",
      offPeakHours: "ช่วงโปรโมชั่น EA Anywhere",
      parkingFee: "คิดค่าจอดตามเกณฑ์ศูนย์การค้า (ฟรี 2 ชม. แรกเมื่อชาร์จ)"
    },
    amenities: ["shopping_mall", "restaurant", "restroom", "cafe"],
    amenitiesText: ["ห้างสรรพสินค้า", "ศูนย์อาหาร", "ห้องน้ำ", "Starbucks"],
    reviews: [
      { id: "r3", user: "ณภัทร EV Life", rating: 4, time: "2 ชั่วโมงที่แล้ว", comment: "ที่จอดรถ EV ชัดเจน รปภ. คอยดูแลไม่ให้รถน้ำมันจอดขวาง" }
    ],
    updatedAt: new Date().toISOString()
  },
  {
    id: "evolt-mega-bangna",
    name: "Evolt เมกาบางนา (ลานจอดรถอิเกีย)",
    nameEn: "Evolt Mega Bangna",
    operator: "Evolt",
    operatorColor: "#06b6d4", // Cyan
    coordinates: { lat: 13.6465, lng: 100.6802 },
    address: "ศูนย์การค้าเมกาบางนา ถ.บางนา-ตราด ต.บางแก้ว อ.บางพลี จ.สมุทรปราการ",
    connectors: [
      { id: "c1", type: "CCS2", powerKW: 120, status: "available" },
      { id: "c2", type: "CCS2", powerKW: 120, status: "available" },
      { id: "c3", type: "Type 2", powerKW: 22, status: "available" }
    ],
    pricing: {
      onPeak: 7.80,
      offPeak: 6.20,
      unit: "บาท/kWh",
      peakHours: "จ.-ศ. 09:00 - 22:00 น.",
      offPeakHours: "จ.-ศ. 22:00 - 09:00 น. และ วันเสาร์-อาทิตย์",
      parkingFee: "จอดฟรี 6 ชม. สำหรับลูกค้าเมกาบางนา"
    },
    amenities: ["shopping_mall", "restaurant", "cafe", "restroom"],
    amenitiesText: ["ห้างเมกาบางนา", "IKEA", "คาเฟ่", "ห้องน้ำ"],
    reviews: [
      { id: "r4", user: "แพรวา EV", rating: 5, time: "เมื่อวานนี้", comment: "ชาร์จเดินช้อปปิ้งเสร็จแบตเต็มพอดี หัวชาร์จใหม่และสายเบา" }
    ],
    updatedAt: new Date().toISOString()
  },
  {
    id: "altervim-shell-wang-noi",
    name: "Altervim ปั๊มเชลล์ วังน้อย (ถนนพหลโยธิน ขาออก)",
    nameEn: "Altervim Shell Wang Noi (Highway 1)",
    operator: "Altervim",
    operatorColor: "#f97316", // Orange
    coordinates: { lat: 14.2255, lng: 100.7160 },
    address: "สถานีบริการน้ำมันเชลล์ ต.ลำไทร อ.วังน้อย จ.พระนครศรีอยุธยา (กม.64 ขาออก)",
    connectors: [
      { id: "c1", type: "CCS2", powerKW: 180, status: "available" },
      { id: "c2", type: "CCS2", powerKW: 180, status: "occupied", currentVehicle: "GWM ORA Good Cat" },
      { id: "c3", type: "CCS2", powerKW: 60, status: "available" }
    ],
    pricing: {
      onPeak: 7.50,
      offPeak: 5.80,
      unit: "บาท/kWh",
      peakHours: "จ.-ศ. 09:00 - 22:00 น.",
      offPeakHours: "จ.-ศ. 22:00 - 09:00 น. และ ส.-อา. ตลอด 24 ชม.",
      parkingFee: "จอดฟรีในปั๊มเชลล์"
    },
    amenities: ["24_hours", "convenience_store", "restroom", "cafe", "restaurant"],
    amenitiesText: ["เปิด 24 ชม.", "Shell Select", "ห้องน้ำ", "Deli Café", "KFC"],
    reviews: [
      { id: "r5", user: "ธีรพล พ.", rating: 5, time: "3 ชั่วโมงที่แล้ว", comment: "ตู้ Ultra-fast 180kW ชาร์จ 20-80% ภายใน 22 นาที จุดแวะวิ่งขึ้นเหนือดีที่สุด" }
    ],
    updatedAt: new Date().toISOString()
  },
  {
    id: "ptt-rama2-outbound",
    name: "PTT EV Station PluZ พระราม 2 (ขาออก กม.35)",
    nameEn: "PTT EV Station PluZ Rama 2 (Outbound)",
    operator: "PTT EV Station PluZ",
    operatorColor: "#0284c7",
    coordinates: { lat: 13.6288, lng: 100.4140 },
    address: "ถ.พระราม 2 ต.บางน้ำจืด อ.เมือง จ.สมุทรสาคร (มุ่งหน้าสมุทรสงคราม/หัวหิน)",
    connectors: [
      { id: "c1", type: "CCS2", powerKW: 120, status: "occupied", currentVehicle: "MG4 Electric" },
      { id: "c2", type: "CCS2", powerKW: 120, status: "occupied", currentVehicle: "BYD Seal" },
      { id: "c3", type: "Type 2", powerKW: 22, status: "available" }
    ],
    pricing: {
      onPeak: 7.70,
      offPeak: 6.00,
      unit: "บาท/kWh",
      peakHours: "จ.-ศ. 09:00 - 22:00 น.",
      offPeakHours: "จ.-ศ. 22:00 - 09:00 น. และ วันหยุดราชการ",
      parkingFee: "ฟรีไม่มีค่าบริการ"
    },
    amenities: ["24_hours", "cafe", "convenience_store", "restroom"],
    amenitiesText: ["เปิด 24 ชม.", "Amazon", "7-Eleven", "ห้องน้ำ"],
    reviews: [
      { id: "r6", user: "กฤติน ช.", rating: 4, time: "1 วันที่แล้ว", comment: "คนใช้เยอะช่วงศุกร์เย็น แนะนำจองคิวผ่านแอพ xplORe ล่วงหน้า" }
    ],
    updatedAt: new Date().toISOString()
  },
  {
    id: "pea-khao-yai-pak-chong",
    name: "PEA VOLTA เขาใหญ่ ปากช่อง (ถนนธนะรัชต์)",
    nameEn: "PEA VOLTA Khao Yai Pak Chong",
    operator: "PEA VOLTA",
    operatorColor: "#9333ea",
    coordinates: { lat: 14.6852, lng: 101.4085 },
    address: "ถ.ธนะรัชต์ ต.หนองน้ำแดง อ.ปากช่อง จ.นครราชสีมา (ทางขึ้นอุทยานเขาใหญ่)",
    connectors: [
      { id: "c1", type: "CCS2", powerKW: 50, status: "available" },
      { id: "c2", type: "CHAdeMO", powerKW: 50, status: "available" },
      { id: "c3", type: "Type 2", powerKW: 22, status: "available" }
    ],
    pricing: {
      onPeak: 7.40,
      offPeak: 5.30,
      unit: "บาท/kWh",
      peakHours: "จ.-ศ. 09:00 - 22:00 น.",
      offPeakHours: "จ.-ศ. 22:00 - 09:00 น. และ ส.-อา.",
      parkingFee: "ฟรีตลอดการชาร์จ"
    },
    amenities: ["24_hours", "restroom", "cafe"],
    amenitiesText: ["เปิด 24 ชม.", "ห้องน้ำ กฟภ.", "ร้านกาแฟใกล้เคียง"],
    reviews: [
      { id: "r7", user: "อรัญญา ส.", rating: 4.5, time: "5 ชั่วโมงที่แล้ว", comment: "จุดชาร์จสำคัญก่อนขึ้นเขาใหญ่ วิวสวย อากาศดี" }
    ],
    updatedAt: new Date().toISOString()
  },
  {
    id: "ea-siam-paragon",
    name: "EA Anywhere สยามพารากอน (ชั้น B1 เสา P12)",
    nameEn: "EA Anywhere Siam Paragon",
    operator: "EA Anywhere",
    operatorColor: "#16a34a",
    coordinates: { lat: 13.7462, lng: 100.5348 },
    address: "ศูนย์การค้าสยามพารากอน ถ.พระราม 1 แขวงปทุมวัน เขตปทุมวัน กรุงเทพฯ",
    connectors: [
      { id: "c1", type: "CCS2", powerKW: 150, status: "available" },
      { id: "c2", type: "CCS2", powerKW: 150, status: "available" },
      { id: "c3", type: "Type 2", powerKW: 22, status: "occupied", currentVehicle: "Volvo EX30" }
    ],
    pricing: {
      onPeak: 7.70,
      offPeak: 6.50,
      unit: "บาท/kWh",
      peakHours: "10:00 - 22:00 น.",
      offPeakHours: "ช่วงอัตราพิเศษ",
      parkingFee: "ตามเกณฑ์ศูนย์การค้าสยามพารากอน"
    },
    amenities: ["shopping_mall", "restaurant", "cafe", "restroom"],
    amenitiesText: ["ห้างสรรพสินค้าชั้นนำ", "Gourmet Market", "คาเฟ่", "ห้องน้ำ"],
    reviews: [
      { id: "r8", user: "ภัทรวดี ม.", rating: 5, time: "เมื่อวานนี้", comment: "หัวชาร์จแรง สภาพสมบูรณ์มาก เสียบแป๊บเดียวช้อปปิ้งเสร็จกลับบ้านได้เลย" }
    ],
    updatedAt: new Date().toISOString()
  },
  {
    id: "pea-motorway-km50",
    name: "PEA VOLTA มอเตอร์เวย์ กรุงเทพ-ชลบุรี (จุดพักรถ กม.50 ขาออก)",
    nameEn: "PEA VOLTA Motorway Chonburi (KM 50)",
    operator: "PEA VOLTA",
    operatorColor: "#9333ea",
    coordinates: { lat: 13.4320, lng: 100.9980 },
    address: "จุดพักรถมอเตอร์เวย์ ทล.7 กม.50 ต.เขาดิน อ.บางปะกง จ.ฉะเชิงเทรา (มุ่งหน้าพัทยา)",
    connectors: [
      { id: "c1", type: "CCS2", powerKW: 160, status: "available" },
      { id: "c2", type: "CCS2", powerKW: 160, status: "available" },
      { id: "c3", type: "Type 2", powerKW: 22, status: "available" }
    ],
    pricing: {
      onPeak: 7.50,
      offPeak: 5.30,
      unit: "บาท/kWh",
      peakHours: "จ.-ศ. 09:00 - 22:00 น.",
      offPeakHours: "จ.-ศ. 22:00 - 09:00 น. และ ส.-อา.",
      parkingFee: "จอดฟรีจุดพักรถ"
    },
    amenities: ["24_hours", "convenience_store", "restroom", "cafe", "restaurant"],
    amenitiesText: ["เปิด 24 ชม.", "จุดพักรถใหญ่", "ห้องน้ำสะอาด", "Starbucks / Amazon", "ศูนย์อาหาร"],
    reviews: [
      { id: "r9", user: "วิทวัส ไดรฟ์", rating: 5, time: "2 วันที่แล้ว", comment: "จุดแวะสำคัญวิ่งลงพัทยา มีตู้ 160kW 2 ตู้ ชาร์จเร็วและสะดวกมาก" }
    ],
    updatedAt: new Date().toISOString()
  },
  {
    id: "ptt-phetkasem-huahin",
    name: "PTT EV Station PluZ เพชรเกษม ชะอำ-หัวหิน (กม.215)",
    nameEn: "PTT EV Station PluZ Cha-am / Hua Hin",
    operator: "PTT EV Station PluZ",
    operatorColor: "#0284c7",
    coordinates: { lat: 12.6321, lng: 99.9512 },
    address: "ถ.เพชรเกษม ต.ชะอำ อ.ชะอำ จ.เพชรบุรี (กม.215 ก่อนเข้าตัวเมืองหัวหิน)",
    connectors: [
      { id: "c1", type: "CCS2", powerKW: 120, status: "available" },
      { id: "c2", type: "CHAdeMO", powerKW: 50, status: "available" },
      { id: "c3", type: "Type 2", powerKW: 22, status: "available" }
    ],
    pricing: {
      onPeak: 7.70,
      offPeak: 6.00,
      unit: "บาท/kWh",
      peakHours: "จ.-ศ. 09:00 - 22:00 น.",
      offPeakHours: "จ.-ศ. 22:00 - 09:00 น. และ ส.-อา.",
      parkingFee: "ฟรีไม่มีค่าจอด"
    },
    amenities: ["24_hours", "cafe", "convenience_store", "restroom"],
    amenitiesText: ["เปิด 24 ชม.", "Amazon", "7-Eleven", "ห้องน้ำ"],
    reviews: [
      { id: "r10", user: "นันทิกา ทริป", rating: 4.8, time: "3 วันที่แล้ว", comment: "ปั๊มใหญ่ จุดชาร์จก่อนเข้าหัวหิน ชาร์จแบตเต็มก่อนเที่ยวสบายใจ" }
    ],
    updatedAt: new Date().toISOString()
  }
];

// In-memory reactive store to guarantee seamless instant reactivity
// even before user adds live Firebase credentials or when offline in sandboxed preview!
class StationStore extends EventTarget {
  constructor() {
    super();
    const cached = localStorage.getItem("ev_thai_stations_data");
    this.stations = cached ? JSON.parse(cached) : JSON.parse(JSON.stringify(INITIAL_THAI_STATIONS));
    this.user = {
      uid: "guest-user-" + Math.floor(Math.random() * 10000),
      displayName: "ผู้ใช้ EV ประเทศไทย",
      email: "ev.driver@thai-electric.com",
      isAnonymous: true
    };
  }

  save() {
    localStorage.setItem("ev_thai_stations_data", JSON.stringify(this.stations));
    this.dispatchEvent(new CustomEvent("stations-changed", { detail: this.stations }));
  }

  getAll() {
    return this.stations;
  }

  updateConnector(stationId, connectorId, newStatus) {
    const station = this.stations.find(s => s.id === stationId);
    if (station) {
      const conn = station.connectors.find(c => c.id === connectorId);
      if (conn) {
        conn.status = newStatus;
        if (newStatus === "available") {
          delete conn.currentVehicle;
        } else if (newStatus === "occupied" && !conn.currentVehicle) {
          conn.currentVehicle = "EV Vehicle";
        }
        station.updatedAt = new Date().toISOString();
        this.save();
        return true;
      }
    }
    return false;
  }

  addCheckIn(stationId, checkInData) {
    const station = this.stations.find(s => s.id === stationId);
    if (station) {
      if (!station.reviews) station.reviews = [];
      station.reviews.unshift({
        id: "r-" + Date.now(),
        user: checkInData.userName || "ผู้ใช้ EV",
        rating: checkInData.rating || 5,
        time: "เมื่อสักครู่",
        comment: checkInData.comment || "ยืนยันสถานะหัวชาร์จพร้อมใช้งาน",
        waitTime: checkInData.waitTime || "ไม่ต้องรอ"
      });
      station.updatedAt = new Date().toISOString();
      this.save();
      return true;
    }
    return false;
  }

  resetToDefault() {
    this.stations = JSON.parse(JSON.stringify(INITIAL_THAI_STATIONS));
    this.save();
  }
}

export const localStore = new StationStore();

/**
 * seedMockStations()
 * Checks if Firestore collection 'charging_stations' is empty.
 * If empty, pre-seeds the collection with realistic Thailand EV hubs.
 */
export async function seedMockStations() {
  console.log("⚡ [Firebase] Checking & Seeding charging_stations collection...");
  try {
    if (isConfigValid()) {
      const stationsCol = collection(db, "charging_stations");
      const snapshot = await getDocs(stationsCol);
      if (snapshot.empty) {
        console.log("⚡ [Firebase] Collection is empty. Seeding initial Thai EV stations to Firestore...");
        for (const st of INITIAL_THAI_STATIONS) {
          await setDoc(doc(db, "charging_stations", st.id), {
            ...st,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
        }
        console.log(`✅ [Firebase] Successfully seeded ${INITIAL_THAI_STATIONS.length} stations to Firestore.`);
      } else {
        console.log(`⚡ [Firebase] Firestore already has ${snapshot.size} stations.`);
      }
    } else {
      console.log("ℹ️ [Firebase] Running in Local / Sandbox Mode with Thai Mock Hubs.");
      localStore.save();
    }
    return localStore.getAll();
  } catch (err) {
    console.warn("⚠️ [Firebase] Could not seed remote Firestore (using local seed):", err.message);
    localStore.save();
    return localStore.getAll();
  }
}

/**
 * Real-time station subscription via onSnapshot
 * Supports both Cloud Firestore and local reactive broadcast.
 */
export function subscribeToStations(onUpdateCallback) {
  // Always trigger immediately with current local data for zero-latency UI
  onUpdateCallback(localStore.getAll());

  // Listen to local reactive changes
  const localHandler = (e) => {
    onUpdateCallback(e.detail);
  };
  localStore.addEventListener("stations-changed", localHandler);

  // If live Firestore is configured, attach Firestore onSnapshot listener
  let unsubscribeFirestore = null;
  if (isConfigValid()) {
    try {
      const stationsQuery = query(collection(db, "charging_stations"));
      unsubscribeFirestore = onSnapshot(stationsQuery, (snapshot) => {
        if (!snapshot.empty) {
          const remoteStations = [];
          snapshot.forEach(docSnap => {
            remoteStations.push({ id: docSnap.id, ...docSnap.data() });
          });
          localStore.stations = remoteStations;
          localStorage.setItem("ev_thai_stations_data", JSON.stringify(remoteStations));
          onUpdateCallback(remoteStations);
        }
      }, (error) => {
        console.warn("⚠️ [Firestore] onSnapshot error:", error.message);
      });
    } catch (e) {
      console.warn("⚠️ [Firestore] Setup listener failed:", e.message);
    }
  }

  // Return cleanup function
  return () => {
    localStore.removeEventListener("stations-changed", localHandler);
    if (unsubscribeFirestore) unsubscribeFirestore();
  };
}

/**
 * Updates port status in Firestore and local reactive store
 */
export async function updateStationConnectorStatus(stationId, connectorId, newStatus) {
  localStore.updateConnector(stationId, connectorId, newStatus);
  if (isConfigValid()) {
    try {
      const stationDocRef = doc(db, "charging_stations", stationId);
      const station = localStore.stations.find(s => s.id === stationId);
      if (station) {
        await updateDoc(stationDocRef, {
          connectors: station.connectors,
          updatedAt: serverTimestamp()
        });
      }
    } catch (err) {
      console.warn("⚠️ [Firestore] Remote update failed:", err.message);
    }
  }
}

/**
 * Adds crowdsourced check-in / review
 */
export async function addStationCheckIn(stationId, checkInData) {
  localStore.addCheckIn(stationId, checkInData);
  if (isConfigValid()) {
    try {
      const checkInCol = collection(db, "charging_stations", stationId, "check_ins");
      await addDoc(checkInCol, {
        ...checkInData,
        createdAt: serverTimestamp()
      });
      const stationDocRef = doc(db, "charging_stations", stationId);
      const station = localStore.stations.find(s => s.id === stationId);
      if (station) {
        await updateDoc(stationDocRef, {
          reviews: station.reviews,
          updatedAt: serverTimestamp()
        });
      }
    } catch (err) {
      console.warn("⚠️ [Firestore] Remote check-in failed:", err.message);
    }
  }
}

/**
 * Simulation runner: randomly toggles port availability to showcase real-time changes
 */
let simulationInterval = null;

export function toggleRealtimeSimulation(callback) {
  if (simulationInterval) {
    clearInterval(simulationInterval);
    simulationInterval = null;
    console.log("🛑 Realtime simulation stopped");
    return false;
  } else {
    console.log("🟢 Realtime simulation started");
    simulationInterval = setInterval(() => {
      const stations = localStore.getAll();
      const randomStation = stations[Math.floor(Math.random() * stations.length)];
      if (!randomStation || !randomStation.connectors || randomStation.connectors.length === 0) return;
      const randomConn = randomStation.connectors[Math.floor(Math.random() * randomStation.connectors.length)];
      
      const states = ["available", "occupied", "occupied", "available"];
      const nextState = randomConn.status === "available" ? "occupied" : "available";
      const vehiclePool = ["Tesla Model 3", "BYD Atto 3", "BYD Seal", "GWM ORA Good Cat", "MG4 Electric", "Volvo EX30"];
      
      randomConn.status = nextState;
      if (nextState === "occupied") {
        randomConn.currentVehicle = vehiclePool[Math.floor(Math.random() * vehiclePool.length)];
      } else {
        delete randomConn.currentVehicle;
      }
      localStore.save();
      
      if (callback) {
        callback({
          station: randomStation,
          connector: randomConn,
          status: nextState
        });
      }
    }, 4500);
    return true;
  }
}

export { app, auth, db };
