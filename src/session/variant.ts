// Copyright (C) 2014-2026 Laurier Sylph. All rights reserved.
import { DEFAULT_VARIANT } from "../shared/protocol.js";

/** Returns the variant only when the model actually offers it. */
export function normalizeVariant(
  variant: unknown,
  variants: readonly string[],
): string | undefined {
  return typeof variant === "string" && variants.includes(variant) ? variant : undefined;
}

/**
 * Picks the variant to apply: the requested one, else the current one if the
 * new model also has it. undefined means the model's default.
 */
export function resolveVariant(
  variants: readonly string[],
  requested?: string,
  current?: string,
): string | undefined {
  const explicit = normalizeVariant(requested, variants);
  if (explicit) return explicit;
  if (requested === DEFAULT_VARIANT) return undefined;
  return normalizeVariant(current, variants);
}
