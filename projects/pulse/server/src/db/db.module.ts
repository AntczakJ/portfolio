import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';

import { AppConfigService } from '../config/app-config.service';
import { createDbHandle, type PulseDb, type PulseDbHandle } from './drizzle';

/** DI token for the Drizzle handle. Inject with `@Inject(DRIZZLE)`. */
export const DRIZZLE = Symbol('DRIZZLE');

/**
 * Holds the postgres-js handle so the module can close the pool on shutdown.
 * Kept separate from the injected `DRIZZLE` (the Drizzle db) so consumers see
 * only the ORM handle, not the raw client.
 */
class DbConnection implements OnApplicationShutdown {
  constructor(readonly handle: PulseDbHandle) {}

  async onApplicationShutdown(): Promise<void> {
    // Drain the pool gracefully on SIGTERM/SIGINT (Nest lifecycle). 5 s
    // timeout so a stuck connection cannot hang the shutdown.
    await this.handle.sql.end({ timeout: 5 });
  }
}

/**
 * Global DB module (ADR-005). Provides the Drizzle handle to every feature
 * module via the `DRIZZLE` token, owns the postgres-js pool lifetime, and
 * drains it on application shutdown.
 */
@Global()
@Module({
  providers: [
    {
      provide: DbConnection,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): DbConnection =>
        new DbConnection(createDbHandle(config.databaseUrl, 10)),
    },
    {
      provide: DRIZZLE,
      inject: [DbConnection],
      useFactory: (conn: DbConnection): PulseDb => conn.handle.db,
    },
  ],
  exports: [DRIZZLE],
})
export class DbModule {}
