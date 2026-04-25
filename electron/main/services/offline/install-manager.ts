/**
 * Install manager — handles downloading and installing offline models and the
 * local inference runtime.  Not yet implemented.
 */
export const installManager = {
  /**
   * Download and install a model by catalog ID.
   * @param modelId  Catalog model identifier.
   * @param onProgress  Optional callback receiving progress as 0–100.
   */
  async install(_modelId: string, _onProgress?: (pct: number) => void): Promise<void> {
    throw new Error("installManager.install() not implemented");
  },

  /** Remove an installed model from disk. */
  async uninstall(_modelId: string): Promise<void> {
    throw new Error("installManager.uninstall() not implemented");
  },
};
