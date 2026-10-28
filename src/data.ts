import publicConfig from "./public-config.json";
import { createClient } from "@supabase/supabase-js";
import type { Dataset } from "./types";
const url = import.meta.env.VITE_SUPABASE_URL || publicConfig.supabaseUrl,
  key =
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    publicConfig.supabasePublishableKey;
export const supabase =
  url && key
    ? createClient(url, key, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      })
    : null;
export const emptyData: Dataset = {
  reader_settings: [],
  purposes: [],
  sources: [],
  articles: [],
  analyses: [],
  tracks: [],
  evaluations: [],
  runs: [],
  nodes: [],
  article_states: [],
  track_notes: [],
};
export async function fetchAll(): Promise<Dataset> {
  if (!supabase) throw new Error("尚未設定雲端連線");
  const tables = Object.keys(emptyData) as (keyof Dataset)[];
  const entries = await Promise.all(
    tables.map(async (table) => {
      const rows: unknown[] = [];
      for (let from = 0; ; from += 1000) {
        let q = supabase!.from(table).select("*");
        q = q.order(
          table === "reader_settings"
            ? "owner_id"
            : table === "article_states"
              ? "article_id"
              : table === "track_notes"
                ? "track_id"
                : "id",
        );
        const { data, error } = await q.range(from, from + 999);
        if (error) throw new Error("雲端讀取失敗：" + error.message);
        rows.push(...data);
        if (data.length < 1000) break;
      }
      return [table, rows];
    }),
  );
  return Object.fromEntries(entries) as unknown as Dataset;
}

export async function fetchWorkspaceOwner(): Promise<string> {
  if (!supabase) throw new Error("尚未設定雲端連線");
  const { data, error } = await supabase
    .from("workspace_access")
    .select("owner_id")
    .eq("singleton", true)
    .single();
  if (error || !data) throw new Error("無法讀取閱讀空間，請稍後重試。");
  return data.owner_id;
}
