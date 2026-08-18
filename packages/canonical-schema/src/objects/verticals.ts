import { z } from 'zod';
import { VerticalIdSchema } from '../ids.js';
import {
  IsoDateTimeSchema,
  RefreshPolicySchema,
  SchemaVersionSchema,
  SlugSchema,
} from '../primitives.js';

/** A vertical is a product/domain (`hvac`), never a fork of the app. */
export const VERTICAL_STATUSES = ['DRAFT', 'ACTIVE', 'DEPRECATED', 'RETIRED'] as const;
export const VerticalStatusSchema = z.enum(VERTICAL_STATUSES);
export type VerticalStatus = z.infer<typeof VerticalStatusSchema>;

export const VerticalSchema = z.object({
  id: VerticalIdSchema,
  slug: SlugSchema,
  name: z.string().min(1).max(200),
  schema_version: SchemaVersionSchema,
  status: VerticalStatusSchema,
  default_refresh_policy: RefreshPolicySchema,
  created_at: IsoDateTimeSchema,
  updated_at: IsoDateTimeSchema,
});
export type Vertical = z.infer<typeof VerticalSchema>;

export const VerticalInsertSchema = VerticalSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export type VerticalInsert = z.infer<typeof VerticalInsertSchema>;
