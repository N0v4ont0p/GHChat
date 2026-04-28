import {
  isDatabaseReady,
  listOfflineModels,
  getOfflineModel,
  upsertOfflineModel,
  deleteOfflineModel,
} from "../database";
import type { OfflineModelRecord } from "../database";

/** Public type for a successfully installed offline model. */
export type InstalledModelRecord = OfflineModelRecord;

/**
 * Model registry — tracks which offline models have been installed and are
 * available for local inference.  Backed by the `offline_models` DB table;
 * falls back to empty state when the database is not ready.
 */
export const modelRegistry = {
  /** Return all installed model records ordered by install time. */
  listInstalled(): InstalledModelRecord[] {
    if (!isDatabaseReady()) return [];
    try {
      return listOfflineModels();
    } catch (err) {
      console.error("[modelRegistry] listInstalled failed:", err);
      return [];
    }
  },

  /** Return true when the given model ID is installed and registered. */
  isInstalled(modelId: string): boolean {
    if (!isDatabaseReady()) return false;
    try {
      return getOfflineModel(modelId) != null;
    } catch {
      return false;
    }
  },

  /**
   * Register an installed model in the DB.
   * Safe to call repeatedly — existing rows are updated in-place.
   */
  register(
    model: Pick<InstalledModelRecord, "id" | "name" | "sizeGb" | "modelPath" | "manifestPath"> &
      Partial<Pick<InstalledModelRecord, "quantization">>,
  ): InstalledModelRecord {
    return upsertOfflineModel(model);
  },

  /** Remove an installed model and all its manifest entries from the DB. */
  unregister(modelId: string): void {
    if (!isDatabaseReady()) return;
    try {
      deleteOfflineModel(modelId);
    } catch (err) {
      console.error("[modelRegistry] unregister failed:", err);
    }
  },
};

