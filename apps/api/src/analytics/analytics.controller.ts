import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import type { Plan } from '../users/user.model';
import { AnalyticsService } from './analytics.service';

type AuthenticatedRequest = Request & { user: AuthenticatedUser };

@UseGuards(JwtAuthGuard)
@Controller('projects')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get(':id/analytics/summary')
  getSummary(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.analyticsService.getSummary(req.user.id, id, req.user.plan as Plan);
  }

  @Get(':id/analytics/trends')
  getTrends(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.analyticsService.getTrends(req.user.id, id, req.user.plan as Plan);
  }

  @Get(':id/analytics/breakdown')
  getBreakdown(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.analyticsService.getBreakdown(req.user.id, id, req.user.plan as Plan);
  }
}
