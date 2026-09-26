import { z } from "zod";
import { keccak256, toBytes } from "viem";

export const TemplateConfig = z
  .object({
    lambda: z.number().int().min(1).max(10000),
    N: z.number().int().min(1).max(64),
    delta: z.number().int().min(0).max(4999),
    fee: z.number().int().min(0).max(9999),
    bounds: z
      .object({
        lambdaMin: z.number().int().min(1).max(10000),
        lambdaMax: z.number().int().min(1).max(10000),
        nMax: z.number().int().min(1).max(64),
        maxStepBps: z.number().int().min(1).max(10000),
        cooldown: z.number().int().min(1).max(4294967295),
      })
      .refine((b) => b.lambdaMin <= b.lambdaMax, "Invalid visibility range"),
  })
  .refine(
    (p) => (p.N - 1) * p.delta <= 2 * p.fee,
    "The fee does not back this drift bound",
  );
export type TemplateConfig = z.infer<typeof TemplateConfig>;
export const PublicationInput = z
  .object({
    kind: z.enum(["strategy", "template"]),
    published: z.boolean(),
    title: z.string().trim().min(3).max(80),
    description: z.string().trim().min(10).max(600),
    config: TemplateConfig.optional(),
  })
  .refine(
    (p) => p.kind !== "template" || !p.published || !!p.config,
    "Template settings required",
  );
export type PublicationInput = z.infer<typeof PublicationInput>;
export type Publication = PublicationInput & {
  id: string;
  label: string;
  name: string;
  owner: string;
  tokenA: string;
  tokenB: string;
  revision: number;
  updatedAt: number;
};
// Sign the entire normalized payload and revision: signatures cannot be repurposed or replayed after an edit.
export function publicationAction(
  label: string,
  revision: number,
  input: PublicationInput,
) {
  const normalized = PublicationInput.parse(input);
  return `${normalized.published ? "publish" : "unpublish"} ${normalized.kind} "${normalized.title}" for ${label} revision ${revision} payload ${keccak256(toBytes(JSON.stringify(normalized)))}`;
}
