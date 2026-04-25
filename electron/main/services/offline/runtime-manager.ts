/**
 * Runtime manager — starts and stops the local inference server process
 * (e.g. llama.cpp, Ollama, or a compatible backend).  Not yet implemented.
 */
export const runtimeManager = {
  /** Start the inference runtime and load the given model. */
  async start(_modelId: string): Promise<void> {
    throw new Error("runtimeManager.start() not implemented");
  },

  /** Stop the running inference runtime. */
  async stop(): Promise<void> {
    throw new Error("runtimeManager.stop() not implemented");
  },

  /** Returns true when the runtime process is currently active. */
  isRunning(): boolean {
    return false;
  },
};
