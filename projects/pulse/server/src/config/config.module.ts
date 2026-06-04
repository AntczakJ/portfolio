import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AppConfigService } from './app-config.service';
import { validateEnv } from './env.schema';

/**
 * Global config module.
 *
 * - `ConfigModule.forRoot` loads `.env` and runs `validateEnv` at boot
 *   (fail-fast on a missing required var).
 * - `@Global` so every feature module can inject `AppConfigService` without
 *   re-importing this module.
 */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
