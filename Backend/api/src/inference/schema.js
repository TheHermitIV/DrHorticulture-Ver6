import { z } from 'zod';

// Scores and probabilities.
const unit = z.number().min(0).max(1);

// The 200 body of POST /v1/analyze, mirroring AnalyzeResponse in contracts/inference.v1.schema.json
// (test/inferenceSchema.test.js checks that the two match). Unknown keys are allowed, as in the
// JSON Schema, and dropped from the parsed result; analyses.raw_response keeps the full body.
export const analyzeResponseSchema = z.object({
  model_version: z.string().min(1),
  segmentation: z.object({
    plant_detected: z.boolean(),
    mask_confidence: unit,
    leaf_fraction: unit,
  }),
  species: z.object({
    top_label: z.string().min(1),
    top_prob: unit,
  }),
  // Color indices such as VARI and ExG; some are negative by definition, so no range.
  features: z.record(z.string(), z.number()),
  estimate: z.object({
    ndvi: z.number().min(-1).max(1),
    confidence: unit,
    ensemble_std: z.number().min(0),
    ensemble_size: z.int().min(1),
  }),
  checks: z.object({
    angle_ok: z.boolean(),
    calibration_card: z.boolean().optional(), // recorded only, not enforced
  }),
});

// { success: true, data } or { success: false, error } with a readable message per problem.
export function parseAnalyzeResponse(body) {
  const result = analyzeResponseSchema.safeParse(body);
  if (result.success) return result;
  return { success: false, error: z.prettifyError(result.error) };
}
