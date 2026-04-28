import * as os from "os";
import { storageService } from "./storage";

/** Snapshot of the host machine's hardware capabilities. */
export interface HardwareProfile {
  /** Total system RAM in gigabytes. */
  totalRamGb: number;
  /** Available free disk space in gigabytes at the offline root. */
  freeDiskGb: number;
  /** Physical CPU core count. */
  cpuCores: number;
  /** Node.js platform string. */
  platform: NodeJS.Platform;
  /** CPU architecture string, e.g. "arm64" or "x64". */
  arch: string;
  /**
   * True when running on Apple Silicon (arm64 macOS).
   * Apple Silicon's unified memory architecture and Metal GPU acceleration
   * allow it to run larger GGUF models efficiently compared to x64 machines
   * with the same nominal RAM amount.
   */
  isAppleSilicon: boolean;
  /** Dedicated GPU VRAM in gigabytes, if a GPU was detected. */
  gpuVramGb?: number;
}

/** Bytes in one gigabyte. */
const BYTES_PER_GB = 1024 ** 3;

/**
 * Hardware profiler — detects RAM, CPU, disk, and platform characteristics
 * to inform offline model recommendations.
 *
 * Uses Node.js built-ins (`os` module) and the existing `storageService`
 * for disk space.  All values are approximate and intended for tier selection,
 * not precision engineering.
 */
export const hardwareProfile = {
  /** Detect the current machine's hardware profile. */
  async detect(): Promise<HardwareProfile> {
    const totalRamGb = os.totalmem() / BYTES_PER_GB;
    const cpuCores = os.cpus().length;
    const platform = os.platform() as NodeJS.Platform;
    const arch = os.arch();
    const isAppleSilicon = platform === "darwin" && arch === "arm64";

    // Disk space at the offline storage root.
    const freeDiskGb = await storageService.availableSpaceGb();

    return {
      totalRamGb,
      freeDiskGb,
      cpuCores,
      platform,
      arch,
      isAppleSilicon,
    };
  },
};
