/**
 * Storage service — resolves the model storage path and reports available
 * disk space.  Not yet implemented.
 */
export const storageService = {
  /** Return the directory where offline models are stored. */
  getModelStorePath(): string {
    throw new Error("storageService.getModelStorePath() not implemented");
  },

  /** Return available disk space in gigabytes at the model store path. */
  async availableSpaceGb(): Promise<number> {
    throw new Error("storageService.availableSpaceGb() not implemented");
  },
};
