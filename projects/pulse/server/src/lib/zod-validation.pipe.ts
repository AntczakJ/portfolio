import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/**
 * A NestJS pipe that validates a value against a Zod schema (conventions § 5
 * — validate at the boundary with the SAME schemas the frontend uses).
 *
 * Usage: `@Body(new ZodValidationPipe(createMonitorSchema)) body: CreateMonitor`.
 * On failure it throws a 400 with the flattened field errors, so the client
 * gets a typed, actionable error shape rather than a stack trace.
 */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        error: 'validation_failed',
        message: 'Request body failed validation.',
        issues: result.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    return result.data;
  }
}
