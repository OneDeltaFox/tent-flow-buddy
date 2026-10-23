export const defaultComplaints = [
  "Abd Pain", "Abrasions", "Arm Pain/Inj", "Back Pain", "Bleeding", "Chest Pain",
  "Dif. Breathing", "Dizziness", "Foot Pain/Inj", "Gen. Weakness", "Hand Pain/Inj",
  "Head Pain", "Heat Exhaustion", "Inj/Fall", "Knee Pain/Inj", "Laceration",
  "Leg Pain/Inj", "Nausea/Vomiting", "Near Syncope", "Syncope", "Unconscious",
];
export type ComplaintOption = { label: string; enabled: boolean };
export const defaultComplaintOptions = (): ComplaintOption[] => defaultComplaints.map(label => ({ label, enabled: true }));
