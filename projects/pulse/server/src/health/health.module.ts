import { Module } from '@nestjs/common';

import { HealthController } from './health.controller';

/** Health module (Task 1.1). DB + Redis come from the global DbModule /
 * RedisModule, so this only declares the controller. */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
