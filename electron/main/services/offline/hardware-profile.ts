/** Snapshot of the host machine's hardware capabilities. */
export interface HardwareProfile {
  /** Total system RAM in gigabytes. */
  totalRamGb: number;
  /** Dedicated GPU VRAM in gigabytes, if a GPU was detected. */
  gpuVramGb?: number;
  /** Physical CPU core count. */
  cpuCores: number;
  platform: NodeJS.Platform;
}

/**
 * Hardware profiler — detects RAM, CPU, and GPU characteristics to inform
 * offline model recommendations.  Not yet implemented.
 */
export const hardwareProfile = {
  /** Detect the current machine's hardware profile. */
  async detect(): Promise<HardwareProfile> {
    throw new Error("hardwareProfile.detect() not implemented");
  },
};
