/**
 * Runtime schema capability shared by read surfaces.
 *
 * Surfaces may own transport envelopes, but they must not each choose a
 * different validator or JSON-Schema projector. Re-exporting this one Zod
 * runtime keeps executable wire schemas and generated contracts on one
 * dialect without letting an interface package reach below the query layer.
 */
import { z } from 'zod';

export const runtimeSchema = z;
export type RuntimeSchemaOutput<Schema extends z.ZodType> = z.output<Schema>;
