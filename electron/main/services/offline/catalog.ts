/** Describes a model available for offline installation. */
export interface OfflineModelEntry {
  id: string;
  name: string;
  /** Approximate download size in gigabytes. */
  sizeGb: number;
  quantization?: string;
  description?: string;
}

/**
 * Offline model catalog — lists models that can be installed for local
 * inference.  Not yet implemented; returns empty lists until a catalog
 * source (e.g. a bundled JSON manifest or remote feed) is wired up.
 */
export const offlineCatalog = {
  /** List all models available for offline installation. */
  listAvailable(): OfflineModelEntry[] {
    return [];
  },
};
