import { getProvider } from "../providers/index.js";
import type { AIProvider } from "../providers/types.js";

export async function getClient(): Promise<AIProvider> {
  const provider = getProvider();
  if (provider.getState() !== "connected") {
    await provider.start();
  }
  return provider;
}

export async function resetClient(): Promise<AIProvider> {
  const provider = getProvider();
  await provider.stop();
  await provider.start();
  return provider;
}

export async function stopClient(): Promise<void> {
  const provider = getProvider();
  await provider.stop();
}
