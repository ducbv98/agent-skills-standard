import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  AWS_REGION: z.string().default("ap-southeast-1"),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_SESSION_TOKEN: z.string().optional(),
  AWS_PROFILE: z.string().optional(),
  AWS_ALLOWED_BUCKET_PREFIX: z.string().default(""),
  AWS_READONLY: z
    .string()
    .transform((v) => v === "true")
    .default("false"),
});

export type AwsConfig = z.infer<typeof EnvSchema>;

export function loadConfig(): AwsConfig {
  return EnvSchema.parse(process.env);
}

/** Returns true if write operations should be blocked. */
export function isReadonly(config: AwsConfig): boolean {
  return config.AWS_READONLY;
}
