// tables.js — small embedded reference data. Used only when an API lacks it.

// ICAO type -> [friendly name, wingspan m]. Common Chicago-area types.
export const TYPES = {
  A318: ["Airbus A318", 34.1], A319: ["Airbus A319", 35.8], A320: ["Airbus A320", 35.8], A20N: ["Airbus A320neo", 35.8],
  A321: ["Airbus A321", 35.8], A21N: ["Airbus A321neo", 35.8], A332: ["Airbus A330-200", 60.3], A333: ["Airbus A330-300", 60.3],
  A339: ["Airbus A330-900neo", 64.0], A359: ["Airbus A350-900", 64.8], A35K: ["Airbus A350-1000", 64.8], A388: ["Airbus A380", 79.8],
  BCS1: ["Airbus A220-100", 35.1], BCS3: ["Airbus A220-300", 35.1],
  B712: ["Boeing 717", 28.4], B737: ["Boeing 737-700", 35.8], B738: ["Boeing 737-800", 35.8], B739: ["Boeing 737-900", 35.8],
  B37M: ["Boeing 737 MAX 7", 35.9], B38M: ["Boeing 737 MAX 8", 35.9], B39M: ["Boeing 737 MAX 9", 35.9], B3XM: ["Boeing 737 MAX 10", 35.9],
  B752: ["Boeing 757-200", 38.1], B753: ["Boeing 757-300", 38.1], B762: ["Boeing 767-200", 47.6], B763: ["Boeing 767-300", 47.6],
  B764: ["Boeing 767-400", 51.9], B772: ["Boeing 777-200", 60.9], B77L: ["Boeing 777-200LR/F", 64.8], B77W: ["Boeing 777-300ER", 64.8],
  B788: ["Boeing 787-8", 60.1], B789: ["Boeing 787-9", 60.1], B78X: ["Boeing 787-10", 60.1], B744: ["Boeing 747-400", 64.4],
  B748: ["Boeing 747-8", 68.4], MD11: ["McDonnell Douglas MD-11", 51.7],
  E170: ["Embraer 170", 26.0], E75L: ["Embraer 175", 26.0], E75S: ["Embraer 175", 26.0], E145: ["Embraer ERJ-145", 20.0],
  E135: ["Embraer ERJ-135", 20.0], E190: ["Embraer 190", 28.7], E290: ["Embraer E190-E2", 33.7],
  CRJ2: ["Bombardier CRJ200", 21.2], CRJ7: ["Bombardier CRJ700", 23.2], CRJ9: ["Bombardier CRJ900", 24.9],
  DH8D: ["De Havilland Dash 8-400", 28.4], AT76: ["ATR 72-600", 27.1],
  C172: ["Cessna 172", 11.0], C182: ["Cessna 182", 11.0], C208: ["Cessna Caravan", 15.9], PA28: ["Piper Cherokee", 10.7],
  SR22: ["Cirrus SR22", 11.7], PC12: ["Pilatus PC-12", 16.3], BE20: ["Beech King Air 200", 16.6], B350: ["Beech King Air 350", 17.7],
  C560: ["Cessna Citation V", 17.0], C56X: ["Cessna Citation Excel", 17.2], C68A: ["Cessna Citation Latitude", 22.0],
  C700: ["Cessna Citation Longitude", 20.6], C25B: ["Cessna CJ3", 15.5], E55P: ["Embraer Phenom 300", 16.2],
  CL35: ["Bombardier Challenger 350", 21.0], CL60: ["Bombardier Challenger 605", 19.6], GLEX: ["Bombardier Global Express", 28.7],
  GL7T: ["Bombardier Global 7500", 31.7], GLF5: ["Gulfstream G550", 28.5], GLF6: ["Gulfstream G650", 30.4], G650: ["Gulfstream G650", 30.4],
  H25B: ["Hawker 800", 15.7], LJ45: ["Learjet 45", 14.6], F2TH: ["Dassault Falcon 2000", 21.4],
  EC35: ["Airbus H135 (helicopter)", 10.2], EC45: ["Airbus H145 (helicopter)", 11.0], A139: ["Leonardo AW139 (helicopter)", 13.8],
  B407: ["Bell 407 (helicopter)", 10.7], B429: ["Bell 429 (helicopter)", 11.0], B505: ["Bell 505 (helicopter)", 11.0],
  R44: ["Robinson R44 (helicopter)", 10.1], R66: ["Robinson R66 (helicopter)", 10.1], H500: ["MD 500 (helicopter)", 8.1],
  AS50: ["Airbus H125 (helicopter)", 10.7], EC30: ["Airbus H130 (helicopter)", 10.7], B06: ["Bell 206 (helicopter)", 10.2], S76: ["Sikorsky S-76 (helicopter)", 13.4],
  C17: ["Boeing C-17 Globemaster", 51.8], C130: ["Lockheed C-130 Hercules", 40.4], K35R: ["Boeing KC-135", 39.9],
};
export const DEFAULT_SPAN = 35;

export const WIDEBODY = new Set(["A332","A333","A339","A359","A35K","A388","B762","B763","B764","B772","B77L","B77W","B788","B789","B78X","B744","B748","MD11","C17"]);
export const BIZJET = new Set(["C560","C56X","C68A","C700","C25B","E55P","CL35","CL60","GLEX","GL7T","GLF5","GLF6","G650","H25B","LJ45","F2TH"]);
export const CARGO_ICAO = new Set(["FDX","UPS","GTI","ABX","ATN","CKS","PAC","CLX","KAL","NCA","AJT","SOO","MXY","QTR"]);

// ICAO airline prefix -> name (text only; no logos).
export const AIRLINES = {
  AAL: "American Airlines", UAL: "United Airlines", DAL: "Delta Air Lines", SWA: "Southwest Airlines", ASA: "Alaska Airlines",
  JBU: "JetBlue", NKS: "Spirit Airlines", FFT: "Frontier Airlines", AAY: "Allegiant Air", SCX: "Sun Country", MXY: "Breeze Airways",
  ENY: "Envoy Air (American Eagle)", SKW: "SkyWest", RPA: "Republic Airways", JIA: "PSA Airlines", EDV: "Endeavor Air",
  ASH: "Mesa Airlines", GJS: "GoJet Airlines", AWI: "Air Wisconsin", QXE: "Horizon Air", PDT: "Piedmont Airlines", CPZ: "Compass Airlines",
  ACA: "Air Canada", JZA: "Air Canada Express (Jazz)", WJA: "WestJet", ROU: "Air Canada Rouge", AMX: "Aeroméxico", VOI: "Volaris",
  BAW: "British Airways", VIR: "Virgin Atlantic", DLH: "Lufthansa", AFR: "Air France", KLM: "KLM", IBE: "Iberia", EIN: "Aer Lingus",
  SWR: "Swiss", AUA: "Austrian", LOT: "LOT Polish", SAS: "SAS", FIN: "Finnair", ICE: "Icelandair", TAP: "TAP Air Portugal", ITY: "ITA Airways",
  THY: "Turkish Airlines", UAE: "Emirates", QTR: "Qatar Airways", ETD: "Etihad", RJA: "Royal Jordanian", ELY: "El Al", AIC: "Air India",
  ANA: "All Nippon Airways", JAL: "Japan Airlines", KAL: "Korean Air", AAR: "Asiana", CPA: "Cathay Pacific", EVA: "EVA Air",
  CCA: "Air China", CES: "China Eastern", CSN: "China Southern", SIA: "Singapore Airlines", QFA: "Qantas", ANZ: "Air New Zealand",
  AVA: "Avianca", CMP: "Copa Airlines", LAN: "LATAM", ETH: "Ethiopian Airlines",
  FDX: "FedEx", UPS: "UPS", GTI: "Atlas Air", ABX: "ABX Air", ATN: "Air Transport International", CKS: "Kalitta Air", CLX: "Cargolux",
  EJA: "NetJets", LXJ: "Flexjet", XOJ: "XOJET", JTL: "Jet Linx", TWY: "Solairus", VJA: "VistaJet", CNS: "Cobalt Air",
  RCH: "US Air Force (Reach)", CNV: "US Navy", N: "Private (US registered)",
};

// Airports: code -> [name, city, lat, lon]. lat/lon only where needed for context.
export const AIRPORTS = {
  KORD: ["O'Hare International", "Chicago", 41.9786, -87.9048], KMDW: ["Midway International", "Chicago", 41.7868, -87.7522],
  KPWK: ["Chicago Executive", "Wheeling", 42.1142, -87.9015], KGYY: ["Gary/Chicago International", "Gary", 41.6163, -87.4128],
  KMKE: ["Milwaukee Mitchell International", "Milwaukee", 42.9472, -87.8966], KRFD: ["Chicago Rockford International", "Rockford", 42.1954, -89.0972],
  KATL: ["Hartsfield–Jackson", "Atlanta"], KDFW: ["Dallas/Fort Worth International", "Dallas–Fort Worth"], KDEN: ["Denver International", "Denver"],
  KLAX: ["Los Angeles International", "Los Angeles"], KJFK: ["John F. Kennedy International", "New York"], KLGA: ["LaGuardia", "New York"],
  KEWR: ["Newark Liberty International", "Newark"], KSFO: ["San Francisco International", "San Francisco"], KSEA: ["Seattle–Tacoma International", "Seattle"],
  KLAS: ["Harry Reid International", "Las Vegas"], KMCO: ["Orlando International", "Orlando"], KMIA: ["Miami International", "Miami"],
  KCLT: ["Charlotte Douglas International", "Charlotte"], KPHX: ["Phoenix Sky Harbor", "Phoenix"], KIAH: ["George Bush Intercontinental", "Houston"],
  KHOU: ["William P. Hobby", "Houston"], KBOS: ["Logan International", "Boston"], KMSP: ["Minneapolis–Saint Paul", "Minneapolis"],
  KDTW: ["Detroit Metropolitan", "Detroit"], KPHL: ["Philadelphia International", "Philadelphia"], KFLL: ["Fort Lauderdale–Hollywood", "Fort Lauderdale"],
  KBWI: ["Baltimore/Washington", "Baltimore"], KDCA: ["Reagan National", "Washington"], KIAD: ["Dulles International", "Washington"],
  KSLC: ["Salt Lake City International", "Salt Lake City"], KSAN: ["San Diego International", "San Diego"], KTPA: ["Tampa International", "Tampa"],
  KAUS: ["Austin–Bergstrom", "Austin"], KBNA: ["Nashville International", "Nashville"], KMCI: ["Kansas City International", "Kansas City"],
  KSTL: ["St. Louis Lambert", "St. Louis"], KDAL: ["Dallas Love Field", "Dallas"], KMSY: ["Louis Armstrong New Orleans", "New Orleans"],
  KRDU: ["Raleigh–Durham", "Raleigh"], KCLE: ["Cleveland Hopkins", "Cleveland"], KCMH: ["John Glenn Columbus", "Columbus"],
  KCVG: ["Cincinnati/Northern Kentucky", "Cincinnati"], KIND: ["Indianapolis International", "Indianapolis"], KPIT: ["Pittsburgh International", "Pittsburgh"],
  KSAT: ["San Antonio International", "San Antonio"], KPDX: ["Portland International", "Portland"], KSJC: ["San José Mineta", "San José"],
  KOMA: ["Eppley Airfield", "Omaha"], KDSM: ["Des Moines International", "Des Moines"], KMSN: ["Dane County Regional", "Madison"],
  KGRR: ["Gerald R. Ford International", "Grand Rapids"], KHNL: ["Daniel K. Inouye", "Honolulu"], KANC: ["Ted Stevens Anchorage", "Anchorage"],
  CYYZ: ["Toronto Pearson", "Toronto"], CYUL: ["Montréal–Trudeau", "Montréal"], CYVR: ["Vancouver International", "Vancouver"],
  MMMX: ["Mexico City International", "Mexico City"], MMUN: ["Cancún International", "Cancún"], MPTO: ["Tocumen International", "Panama City"],
  EGLL: ["Heathrow", "London"], EGKK: ["Gatwick", "London"], EIDW: ["Dublin", "Dublin"], LFPG: ["Charles de Gaulle", "Paris"],
  EHAM: ["Schiphol", "Amsterdam"], EDDF: ["Frankfurt", "Frankfurt"], EDDM: ["Munich", "Munich"], LSZH: ["Zürich", "Zürich"],
  LOWW: ["Vienna", "Vienna"], EPWA: ["Warsaw Chopin", "Warsaw"], LEMD: ["Madrid–Barajas", "Madrid"], LIRF: ["Rome Fiumicino", "Rome"],
  BIKF: ["Keflavík", "Reykjavík"], LTFM: ["Istanbul", "Istanbul"], OMDB: ["Dubai International", "Dubai"], OTHH: ["Hamad International", "Doha"],
  OMAA: ["Zayed International", "Abu Dhabi"], VIDP: ["Indira Gandhi International", "Delhi"], VABB: ["Chhatrapati Shivaji Maharaj", "Mumbai"],
  RJAA: ["Narita", "Tokyo"], RJTT: ["Haneda", "Tokyo"], RKSI: ["Incheon", "Seoul"], VHHH: ["Hong Kong International", "Hong Kong"],
  RCTP: ["Taoyuan", "Taipei"], ZBAA: ["Beijing Capital", "Beijing"], ZSPD: ["Pudong", "Shanghai"], WSSS: ["Changi", "Singapore"],
  YSSY: ["Sydney Kingsford Smith", "Sydney"], NZAA: ["Auckland", "Auckland"], SBGR: ["São Paulo–Guarulhos", "São Paulo"], SKBO: ["El Dorado", "Bogotá"],
  HAAB: ["Bole International", "Addis Ababa"], OJAI: ["Queen Alia International", "Amman"], LLBG: ["Ben Gurion", "Tel Aviv"],
};
// IATA -> ICAO for the main fields (hexdb gives ICAO; some APIs give IATA).
export const IATA = { ORD: "KORD", MDW: "KMDW", PWK: "KPWK", GYY: "KGYY", MKE: "KMKE", RFD: "KRFD" };

export function airportLabel(code) {
  if (!code) return null;
  const a = AIRPORTS[code] || AIRPORTS[IATA[code]];
  return a ? { code, name: a[0], city: a[1] } : { code, name: null, city: null };
}

export const PILOT_JOKES = [
  "Captain: classified. Probably named Dave.",
  "First officer: unknown. Has opinions about the coffee.",
  "Crew list not public. One of them definitely said \"folks\" on the PA.",
  "Pilot names are private. Statistically, someone up there is called Mike.",
  "Captain: unlisted. Currently explaining a 20-minute ground hold.",
  "Flight deck: anonymous. Window seat: also not you.",
];

// Willis Tower roof (compass check target), public landmark.
export const WILLIS = { lat: 41.8789, lon: -87.6359, topM: 442 + 181 };
