// Response shapes of the desk API functions the spike uses. Mirrors Code.gs;
// every shape is already Date-free (the HtmlService desk had the same rule).

export interface Dealer { key: string; name: string; splitDealLabel: string | null }
export interface UserProfile { key: string; name: string }
export interface Bootstrap {
  dealers: Dealer[];
  users: { profiles: UserProfile[]; lastUser: string };
  appTheme: string;
}

export interface Ping { env: string; email: string; note: string; at: string }

export interface ScheduleDealer { key: string; name: string; pending: number; runs?: number; vins?: number; dupes?: number; scheduled?: boolean }
export interface PrintSchedule {
  ok: boolean; configured: boolean; day: string;
  upNext: ScheduleDealer[]; ranToday: ScheduleDealer[];
  totals: { runs: number; vins: number; dupes: number } | null;
  error?: string;
}
export interface DraftSummary { dealerKey: string; dealerName: string; vinCount: number; updatedAt: number }
export interface Drafts { ok: boolean; drafts: DraftSummary[] }
export interface Submission { id: string; dealerKey: string; dealerName: string; vin: string; valid: boolean; matched: boolean; status: string }
export interface Submissions { ok: boolean; configured: boolean; submissions: Submission[] }
export interface RunLogRow { dealerKey: string; dealerName?: string; status: string; dealId: string | number }

export interface CaoSummary {
  totalInventory: number; afterFiltering: number; alreadyPrinted: number; netNew: number;
  rejectionBreakdown: Record<string, number>;
}
export interface CaoResult { vins: string[]; summary: CaoSummary }

export interface VehicleRow { year: string; make: string; model: string; type: string; stock: string; status: string; url: string }
export interface DealerVinData {
  vinData: Record<string, VehicleRow>;
  featuresTypes: Record<string, boolean>;
  editCodes: Record<string, { code: string; max: number | null }[]>;
  editSeeds: Record<string, Record<string, string>>;
  filtered: Record<string, string>;
}
export interface LoggedIdentifiers { identifiers: string[] }

export interface RunProgress { message: string; percent: number; done: boolean; error: string | null }

export interface PendingRun {
  groupKey: string; label: string; dealLabel: string;
  totalOrdered: number; totalMatched: number;
  billing: unknown; producedVins: string[]; note: string; prefillDealId: string;
  outputDocId: string; qrFileIds: string[]; csvFileIds: string[];
  durationSec: number; errors: string[];
  pushModes: { newDeal?: boolean; existing?: boolean };
}
export interface RunResult { outputFolderUrl: string; pendingRuns: PendingRun[]; dealerName: string; producedVinCount: number }
export interface FinalizeResult { rowIndex: number; vinCount: number }
