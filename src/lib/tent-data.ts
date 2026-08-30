export type BedStatus = "open" | "occupied" | "critical" | "cleaning";

export type Triage = "immediate" | "delayed" | "minor";

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
  capabilities: string[];
  staff: string[];
  beds: Bed[];
};

export type Incoming = {
  id: string;
  bib: string;
  source: string;
  eta: string;
  triage: Triage;
  complaint: string;
  operationalStatus?: string | undefined;
};

export type DispositionCategory =
  | "returned"
  | "discharged"
  | "ems"
  | "hospital"
  | "other";

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
  { id: "returned", label: "Returned to Event" },
  { id: "discharged", label: "Discharged" },
  { id: "ems", label: "EMS Transport" },
  { id: "hospital", label: "Hospital / ED Transfer" },
  { id: "other", label: "Other" },
];

export function emptyPod(id: string, name: string, zone: string, note = ""): Pod {
  return {
    id,
    name,
    zone,
    note,
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
    capabilities: ["IV Access", "Cooling", "ALS"],
    staff: ["MD Chen", "RN Miller", "RN Ortiz"],
    beds: [
      bed("A1", "critical", "2201", "14:58", "immediate", "Heat illness", "Cooling"),
      bed("A2", "critical", "0009", "15:05", "immediate", "Collapse", "Awaiting transport"),
      bed("A3", "occupied", "0412", "14:10", "delayed", "Overheated", "Recheck"),
      bed("A4", "open"),
    ],
  },
  {
    id: "B",
    name: "Pod B - IV / Hydration",
    zone: "Center left",
    note: "Two chairs available for overflow",
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
    name: "Pod E - Minor / Fast Track",
    zone: "Rear left",
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
    triage: "minor",
    complaint: "Cramping",
    operationalStatus: "Walking",
  },
];

export const initialDispositions: Disposition[] = [
  {
    id: "d1",
    bib: "4401",
    category: "returned",
    time: "15:03",
    from: "Pod E",
    triage: "minor",
    complaint: "Blister care",
  },
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
  {
    id: "d5",
    bib: "1928",
    category: "hospital",
    time: "14:31",
    from: "Pod A",
    triage: "immediate",
    complaint: "Heat illness",
  },
  {
    id: "d6",
    bib: "0761",
    category: "returned",
    time: "14:22",
    from: "Pod C",
    triage: "minor",
    complaint: "Taping",
  },
];
