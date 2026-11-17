// What the current AI call is part of (set by the worker around each job step), so claude.js can tell whether it may
// use the half-price batch mode and which job to note it on, without every step passing it along.
import { AsyncLocalStorage } from "node:async_hooks";

export const aiContext = new AsyncLocalStorage();
export const currentAi = () => aiContext.getStore() || {};
// Jobs the owner asked to finish now at full price: a batch they're waiting on is cancelled and asked again normally.
export const skipBatch = new Set();
