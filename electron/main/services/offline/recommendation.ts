import type { HardwareProfile } from "./hardware-profile";
import type { OfflineModelEntry } from "./catalog";

export interface ModelRecommendation {
  model: OfflineModelEntry;
  /** Human-readable explanation of why this model fits the hardware. */
  reason: string;
}

/**
 * Recommendation service — matches available models to the detected hardware
 * profile and returns a ranked list of suggestions.  Not yet implemented.
 */
export const recommendationService = {
  /** Return ranked model recommendations for the given hardware profile. */
  async recommend(_profile: HardwareProfile): Promise<ModelRecommendation[]> {
    throw new Error("recommendationService.recommend() not implemented");
  },
};
