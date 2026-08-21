import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { BillingService } from './billing.service';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';

type AuthenticatedRequest = Request & { user: AuthenticatedUser };

@UseGuards(JwtAuthGuard)
@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get('subscription')
  getSubscription(@Req() req: AuthenticatedRequest) {
    return this.billingService.getSubscriptionSummary(req.user.id);
  }

  @Post('checkout')
  createCheckoutSession(@Req() req: AuthenticatedRequest, @Body() dto: CreateCheckoutSessionDto) {
    return this.billingService.createCheckoutSession(req.user.id, dto.targetPlan);
  }

  @Post('portal')
  createPortalSession(@Req() req: AuthenticatedRequest) {
    return this.billingService.createPortalSession(req.user.id);
  }
}
