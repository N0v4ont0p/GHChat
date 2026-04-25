/** Persisted record for a successfully installed offline model. */
export interface InstalledModelRecord {
  id: string;
  name: string;
  /** Epoch timestamp of when the model was installed. */
  installedAt: number;
  sizeGb: number;
}

/**
 * Model registry — tracks which offline models have been installed and are
 * available for local inference.  Not yet implemented; returns empty state
 * until backed by persistent storage.
 */
export const modelRegistry = {
  /** Return all installed model records. */
  listInstalled(): InstalledModelRecord[] {
    return [];
  },

  /** Return true when the given model ID is installed and ready. */
  isInstalled(_modelId: string): boolean {
    return false;
  },
};
