import { Module } from '@nestjs/common';

import { RootController } from './root.controller';

/**
 * Root module — the `GET /` service banner. `AppConfigService` comes from the
 * global AppConfigModule, so this only declares the controller.
 */
@Module({
  controllers: [RootController],
})
export class RootModule {}
