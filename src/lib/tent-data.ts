export type BedStatus = "open" | "occupied" | "critical" | "cleaning";

export type Bed = {
  id: string;
  label: string;
  status: BedStatus;
  bib?: string;
  since?: string;
  note?: string;
};

export type Pod = {
  id: string;
  name: string;
  zone: string;
  capabilities: string[];
  staff: string[];
  beds: Bed[];
};

export type Incoming = {
  id: string;
  bib: string;
  source: string;
  eta: string;
  priority: "critical" | "standard";
  note: string;
};

export type Departure = {
  id: string;
  bib: string;
  destination: string;
  time: string;
  kind: "self" | "transport" | "moved";
};

function bed(
  label: string,
  status: BedStatus,
  bib?: string,
  since?: string,
  note?: string,
): Bed {
  return { id: label, label, status, bib, since, note };
}

export const pods: Pod[] = [
  {
    id: "A",
    name: "Pod A — Acute",
    zone: "Front / EMS door",
    capabilities: ["IV Access", "Cooling", "ALS"],
    staff: ["MD Chen", "RN Miller", "RN Ortiz"],
    beds: [
      bed("A1", "critical", "2201", "14:58", "Cooling immersion"),
      bed("A2", "critical", "0009", "15:05", "Awaiting transport"),
      bed("A3", "occupied", "0412", "14:10"),
      bed("A4", "occupied", "0099", "14:38"),
      bed("A5", "cleaning"),
      bed("A6", "open"),
      bed("A7", "open"),
      bed("A8", "open"),
    ],
  },
  {
    id: "B",
    name: "Pod B — IV / Hydration",
    zone: "Center left",
    capabilities: ["IV Access", "Electrolytes"],
    staff: ["RN Sarah K.", "MA Diaz"],
    beds: [
      bed("B1", "occupied", "0142", "14:20"),
      bed("B2", "occupied", "0881", "14:35"),
      bed("B3", "occupied", "0109", "14:42"),
      bed("B4", "occupied", "0556", "14:50"),
      bed("B5", "open"),
      bed("B6", "open"),
      bed("B7", "cleaning"),
      bed("B8", "open"),
      bed("B9", "open"),
      bed("B10", "open"),
    ],
  },
  {
    id: "C",
    name: "Pod C — Ortho / Podiatry",
    zone: "Center right",
    capabilities: ["Splinting", "Podiatry", "Wound Care"],
    staff: ["RN Patel", "Ortho Tech Wu"],
    beds: [
      bed("C1", "occupied", "0992", "14:12"),
      bed("C2", "occupied", "0045", "14:55"),
      bed("C3", "occupied", "1282", "15:02"),
      bed("C4", "open"),
      bed("C5", "open"),
      bed("C6", "open"),
    ],
  },
  {
    id: "D",
    name: "Pod D — Cooling",
    zone: "Shade wall",
    capabilities: ["Ice Bath x2", "Fans", "Rectal Temp"],
    staff: ["MA Nguyen"],
    beds: [
      bed("D1", "occupied", "0733", "15:01"),
      bed("D2", "occupied", "1190", "15:04"),
      bed("D3", "occupied", "0318", "15:06"),
      bed("D4", "open"),
      bed("D5", "open"),
      bed("D6", "open"),
      bed("D7", "open"),
      bed("D8", "open"),
    ],
  },
  {
    id: "E",
    name: "Pod E — Minor / Fast Track",
    zone: "Rear left",
    capabilities: ["Blister Care", "Abrasions", "Taping"],
    staff: ["RN Boone", "Volunteer x3"],
    beds: [
      bed("E1", "occupied", "1044", "14:47"),
      bed("E2", "occupied", "0620", "14:52"),
      bed("E3", "open"),
      bed("E4", "open"),
      bed("E5", "open"),
      bed("E6", "cleaning"),
      bed("E7", "open"),
      bed("E8", "open"),
      bed("E9", "open"),
      bed("E10", "open"),
      bed("E11", "open"),
      bed("E12", "open"),
    ],
  },
  {
    id: "F",
    name: "Pod F — Observation",
    zone: "Rear right / exit",
    capabilities: ["Recliners", "Oral Fluids"],
    staff: ["RN Alvarez"],
    beds: [
      bed("F1", "occupied", "0005", "14:33"),
      bed("F2", "occupied", "0011", "14:36"),
      bed("F3", "occupied", "0082", "14:41"),
      bed("F4", "occupied", "0045", "14:44"),
      bed("F5", "open"),
      bed("F6", "open"),
      bed("F7", "open"),
      bed("F8", "open"),
      bed("F9", "open"),
      bed("F10", "open"),
    ],
  },
];

export const incoming: Incoming[] = [
  {
    id: "i1",
    bib: "8821",
    source: "Mile 22 — water station",
    eta: "2 min",
    priority: "critical",
    note: "Heat / altered",
  },
  {
    id: "i2",
    bib: "1402",
    source: "Finish chute A",
    eta: "5 min",
    priority: "critical",
    note: "Collapse, wheelchair",
  },
  {
    id: "i3",
    bib: "0104",
    source: "Finish chute B",
    eta: "8 min",
    priority: "standard",
    note: "Lower limb",
  },
  {
    id: "i4",
    bib: "2210",
    source: "Mile 18",
    eta: "12 min",
    priority: "standard",
    note: "Cramping, walking",
  },
];

export const departures: Departure[] = [
  { id: "d1", bib: "4401", destination: "Self-discharge", time: "15:03", kind: "self" },
  { id: "d2", bib: "0129", destination: "Hospital transport", time: "14:58", kind: "transport" },
  { id: "d3", bib: "9211", destination: "Medical Tent 2", time: "14:46", kind: "moved" },
  { id: "d4", bib: "0442", destination: "Self-discharge", time: "14:40", kind: "self" },
  { id: "d5", bib: "1928", destination: "Hospital transport", time: "14:31", kind: "transport" },
  { id: "d6", bib: "0761", destination: "Family pickup", time: "14:22", kind: "self" },
];
