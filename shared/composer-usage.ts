/** Counters only. This contract carries no transcript text or authentication data. */
export interface RecordedQuota {
  readonly observed_at: string | null;
  readonly windows: readonly {
    readonly minutes: number;
    readonly used_percent: number;
    readonly resets_at: string | null;
  }[];
}

/** One pane's latest recorded model request, never cumulative session billing. */
export interface SessionUsage {
  readonly provider: "codex" | "claude";
  readonly model: string | null;
  readonly observed_at: string | null;
  readonly context: {
    readonly used: number | null;
    /** Session or status-line data only; never a model-name lookup. */
    readonly limit: number | null;
    /** Codex includes the response; Claude reports the request input. */
    readonly basis: "input" | "total";
  };
  readonly cache: {
    readonly read_tokens: number | null;
    readonly creation_tokens: number | null;
    /** All input: Codex includes cache reads; Claude requires their addition. */
    readonly input_tokens: number | null;
  };
  /** A recorded account-limit observation, with no claim of current account binding. */
  readonly quota: RecordedQuota | null;
}
