export const defaultComplaints = [
  "Abd Pain", "Abrasions", "Arm Pain/Inj", "Back Pain", "Bleeding", "Chest Pain",
  "Dif. Breathing", "Dizziness", "Foot Pain/Inj", "Gen. Weakness", "Hand Pain/Inj",
  "Head Pain", "Heat Exhaustion", "Inj/Fall", "Knee Pain/Inj", "Laceration",
  "Leg Pain/Inj", "Nausea/Vomiting", "Near Syncope", "Syncope", "Unconscious",
];
export type ComplaintOption = { label: string; enabled: boolean };
export const defaultComplaintOptions = (): ComplaintOption[] => defaultComplaints.map(label => ({ label, enabled: true }));

// Rank current visits once each, including dispositions; never persist usage totals.
export function mostUsedComplaints(visits: {id: string; complaint?: string | null}[], allowed: string[]): string[] {
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  const labels = new Set(allowed.filter(label => label && label !== "Other"));
  for (const visit of visits) {
    if (seen.has(visit.id)) continue;
    seen.add(visit.id);
    if (visit.complaint && labels.has(visit.complaint)) counts.set(visit.complaint, (counts.get(visit.complaint) ?? 0) + 1);
  }
  return [...counts].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0])).slice(0,5).map(([label]) => label);
}
