export type BedStatus = "open" | "occupied" | "cleaning";

export type Triage = "untriaged" | "immediate" | "delayed" | "minor";

export type Bed = {
  id: string;
  label: string;
  status: BedStatus;
  bib?: string | undefined;
  since?: string | undefined;
  triage?: Triage | undefined;
  complaint?: string | undefined;
  operationalStatus?: string | undefined;
};

export type Pod = {
  id: string;
  name: string;
  zone: string;
  note?: string | undefined;
  color: string;
  capabilities: string[];
  staff: string[];
  beds: Bed[];
};

export type Incoming = {
  id: string;
  bib: string;
  source?: string | undefined;
  eta?: string | undefined;
  triage: Triage;
  complaint: string;
  operationalStatus?: string | undefined;
};

export type DispositionCategory = "discharged" | "ems" | "other";

export type Disposition = {
  id: string;
  bib: string;
  category: DispositionCategory;
  time: string;
  from: string;
  triage?: Triage | undefined;
  complaint?: string | undefined;
};

function bed(
  label: string,
  status: BedStatus,
  bib?: string,
  since?: string,
  triage?: Triage,
  complaint?: string,
  operationalStatus?: string,
): Bed {
  return { id: label, label, status, bib, since, triage, complaint, operationalStatus };
}

export const BEDS_PER_POD = 4;

export const dispositionCategories: Array<{
  id: DispositionCategory;
  label: string;
}> = [
  { id: "discharged", label: "Discharged" },
  { id: "ems", label: "EMS Transport" },
  { id: "other", label: "Other" },
];

export function emptyPod(
  id: string,
  name: string,
  zone: string,
  note = "",
  color = "#38bdf8",
): Pod {
  return {
    id,
    name,
    zone,
    note,
    color,
    capabilities: [],
    staff: [],
    beds: Array.from({ length: BEDS_PER_POD }, (_, i) => bed(`${id}${i + 1}`, "open")),
  };
}

export const initialPods: Pod[] = [
  {
    id: "A",
    name: "Pod A - Acute",
    zone: "Front / EMS door",
    note: "Keep one open bed when possible",
    color: "#ef4444",
    capabilities: ["IV Access", "Cooling", "ALS"],
    staff: ["MD Chen", "RN Miller", "RN Ortiz"],
    beds: [
      bed("A1", "occupied", "2201", "14:58", "immediate", "Heat illness", "Cooling"),
      bed("A2", "occupied", "0009", "15:05", "immediate", "Collapse", "Awaiting transport"),
      bed("A3", "occupied", "0412", "14:10", "delayed", "Overheated", "Recheck"),
      bed("A4", "open"),
    ],
  },
  {
    id: "B",
    name: "Pod B - IV / Hydration",
    zone: "Center left",
    note: "Two chairs available for overflow",
    color: "#f59e0b",
    capabilities: ["IV Access", "Electrolytes"],
    staff: ["RN Sarah K.", "MA Diaz"],
    beds: [
      bed("B1", "occupied", "0142", "14:20", "delayed", "Dehydration", "IV running"),
      bed("B2", "occupied", "0881", "14:35", "delayed", "Lightheaded", "Watching"),
      bed("B3", "occupied", "0109", "14:42", "minor", "Cramping"),
      bed("B4", "open"),
    ],
  },
  {
    id: "C",
    name: "Pod C - Ortho / Podiatry",
    zone: "Center right",
    color: "#22c55e",
    capabilities: ["Splinting", "Podiatry", "Wound Care"],
    staff: ["RN Patel", "Ortho Tech Wu"],
    beds: [
      bed("C1", "occupied", "0992", "14:12", "delayed", "Ankle pain"),
      bed("C2", "occupied", "0045", "14:55", "minor", "Blister care"),
      bed("C3", "occupied", "1282", "15:02", "delayed", "Knee pain", "Evaluating"),
      bed("C4", "open"),
    ],
  },
  {
    id: "D",
    name: "Pod D - Cooling",
    zone: "Shade wall",
    note: "Ice bath lane kept clear",
    color: "#06b6d4",
    capabilities: ["Ice Bath x2", "Fans", "Cooling"],
    staff: ["MA Nguyen"],
    beds: [
      bed("D1", "occupied", "0733", "15:01", "immediate", "Heat illness", "Ice bath"),
      bed("D2", "occupied", "1190", "15:04", "delayed", "Overheated", "Cooling"),
      bed("D3", "occupied", "0318", "15:06", "delayed", "Dizziness", "Monitoring"),
      bed("D4", "open"),
    ],
  },
  {
    id: "E",
    name: "Pod E - Green / Fast Track",
    zone: "Rear left",
    color: "#a3e635",
    capabilities: ["Blister Care", "Abrasions", "Taping"],
    staff: ["RN Boone", "Volunteer x3"],
    beds: [
      bed("E1", "occupied", "1044", "14:47", "minor", "Abrasions"),
      bed("E2", "occupied", "0620", "14:52", "minor", "Chafing / taping"),
      bed("E3", "open"),
      bed("E4", "open"),
    ],
  },
  {
    id: "F",
    name: "Pod F - Observation",
    zone: "Rear right / exit",
    color: "#8b5cf6",
    capabilities: ["Recliners", "Oral Fluids"],
    staff: ["RN Alvarez"],
    beds: [
      bed("F1", "occupied", "0005", "14:33", "delayed", "Post-IV observation"),
      bed("F2", "occupied", "0011", "14:36", "minor", "Nausea", "Oral fluids"),
      bed("F3", "occupied", "0082", "14:41", "minor", "Fatigue", "Resting"),
      bed("F4", "open"),
    ],
  },
];

export const initialIncoming: Incoming[] = [
  {
    id: "i1",
    bib: "8821",
    source: "Mile 22 - water station",
    eta: "2 min",
    triage: "immediate",
    complaint: "Heat / altered",
    operationalStatus: "Inbound",
  },
  {
    id: "i2",
    bib: "1402",
    source: "Finish chute A",
    eta: "5 min",
    triage: "immediate",
    complaint: "Collapse",
    operationalStatus: "Wheelchair",
  },
  {
    id: "i3",
    bib: "0104",
    source: "Finish chute B",
    eta: "8 min",
    triage: "delayed",
    complaint: "Lower limb pain",
    operationalStatus: "Walking",
  },
  {
    id: "i4",
    bib: "2210",
    source: "Mile 18",
    eta: "12 min",
    triage: "untriaged",
    complaint: "Cramping",
    operationalStatus: "Walking",
  },
];

export const initialDispositions: Disposition[] = [
  {
    id: "d2",
    bib: "0129",
    category: "ems",
    time: "14:58",
    from: "Pod A",
    triage: "immediate",
    complaint: "Collapse",
  },
  {
    id: "d3",
    bib: "9211",
    category: "other",
    time: "14:46",
    from: "Medical Tent 2",
    triage: "delayed",
    complaint: "Transfer between tents",
  },
  {
    id: "d4",
    bib: "0442",
    category: "discharged",
    time: "14:40",
    from: "Pod F",
    triage: "minor",
    complaint: "Fatigue",
  },
];
