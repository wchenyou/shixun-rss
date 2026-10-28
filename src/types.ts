export interface Purpose {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  daily_time: string;
  version: number;
}
export interface Source {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  daily_time: string;
  version: number;
}
export interface Article {
  id: string;
  title: string;
  url: string;
  source_name: string;
  published_at: string | null;
  collected_at: string;
  content: string;
}
export interface Analysis {
  id: string;
  article_id: string;
  run_id: string;
  summary: string;
  relevance: string;
  purpose_ids: string[];
}
export interface PurposeReport {
  purpose_id: string;
  title: string;
  overview: string;
  sections: {
    heading: string;
    paragraphs: string[];
    bullets: string[];
    tables: { headers: string[]; rows: string[][] }[];
    evidence_ids: string[];
  }[];
  conclusion: string;
  next_steps: string[];
  limitations: string[];
  evidence_ids: string[];
  _execution?: { provider: string; model: string };
}
export interface Track {
  id: string;
  purpose_id: string;
  title: string;
  question: string;
  status: "candidate" | "active" | "paused" | "archived";
  version: number;
  manual?: boolean;
  deleted_at?: string | null;
  origin_excerpt?: string;
  origin_kind?: string;
  origin_article_id?: string | null;
  origin_report_id?: string | null;
  origin_evidence_ids?: string[];
  created_at: string;
}
export interface Evaluation {
  id: string;
  track_id: string;
  run_id: string;
  summary: string;
  change: string;
  evidence_ids: string[];
  counter_evidence: string;
  next_question: string;
  created_at: string;
  applicable: boolean;
}
export interface Run {
  id: string;
  status: string;
  published_at: string | null;
  started_at: string;
  data_cutoff: string | null;
  report: string;
  source_results: {
    name: string;
    ok: boolean;
    count: number;
    error?: string;
    note?: string;
  }[];
  config_snapshot: {
    purpose_reports?: PurposeReport[];
    purposes: Purpose[];
    tracks: Track[];
    _execution?: {
      collector: string;
      model: string;
      web_search: boolean;
      rss: boolean;
    };
  };
  error: string | null;
}
export interface ReaderSettings {
  owner_id?: string;
  daily_budget: number;
  daily_calls: number;
  batch_articles: number;
  body_chars: number;
  include_terms: string;
  exclude_terms: string;
  version?: number;
}
export interface NodeStatus {
  agent_version?: string;
  usage_summary?: {
    day: string;
    accounted_tokens: number;
    reported_tokens: number;
    unknown_runs: number;
    calls: number;
    pending: number;
    filtered: number;
  };
  id: string;
  last_seen: string;
  status: string;
  pending_articles: number;
  pending_uploads: number;
  next_retry_at: string | null;
  last_check_at: string | null;
  error: string | null;
}
export interface ArticleState {
  article_id: string;
  saved: boolean;
  read: boolean;
  note: string;
}
export interface TrackNote {
  track_id: string;
  note: string;
}
export interface Dataset {
  reader_settings: ReaderSettings[];
  purposes: Purpose[];
  sources: Source[];
  articles: Article[];
  analyses: Analysis[];
  tracks: Track[];
  evaluations: Evaluation[];
  runs: Run[];
  nodes: NodeStatus[];
  article_states: ArticleState[];
  track_notes: TrackNote[];
}
