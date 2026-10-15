import type { ReactNode } from "react";
import type { PatientRef } from "@/components/patient-movement";
import type { Pod, Incoming, Disposition, Triage, DispositionCategory } from "./tent-data";

export type PatientDetails = { bib: string; triage: Triage; complaint?: string | undefined; operationalStatus?: string | undefined; source?: string | undefined; eta?: string | undefined };
export type BoardCommand =
  | { action: "save"; ref?: PatientRef; details: PatientDetails; bed?: string }
  | { action: "move"; ref: PatientRef; bed: string }
  | { action: "disposition"; ref: PatientRef; category: DispositionCategory; description?: string | undefined }
  | { action: "ready"; bed: string };
export type ConnectedBoard = {
  pods: Pod[]; incoming: Incoming[]; dispositions: Disposition[]; eventName: string;
  run: (command: BoardCommand) => Promise<boolean>;
  settings: ReactNode;
  readOnly: boolean;
};
