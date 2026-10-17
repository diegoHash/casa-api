import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  getHealth() {
    return {
      service: 'casa-api',
      status: 'ok',
      build: process.env.CASA_BUILD_SHA || 'unknown',
      timestamp: new Date().toISOString(),
    };
  }
}
