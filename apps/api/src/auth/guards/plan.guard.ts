import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { REQUIRED_PLAN_KEY } from '../decorators/required-plan.decorator';
import type { AuthenticatedUser } from '../types/authenticated-user.type';
import { Plan } from '../../users/user.model';

const PLAN_LEVELS: Record<Plan, number> = {
  [Plan.free]: 0,
  [Plan.starter]: 1,
  [Plan.pro]: 2,
  [Plan.enterprise]: 3,
};

type AuthenticatedRequest = Request & { user?: AuthenticatedUser };

@Injectable()
export class PlanGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPlan = this.reflector.get<Plan>(REQUIRED_PLAN_KEY, context.getHandler());
    if (!requiredPlan) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userPlan = (request.user?.plan as Plan) ?? Plan.free;

    if (PLAN_LEVELS[userPlan] < PLAN_LEVELS[requiredPlan]) {
      throw new ForbiddenException(`Cette fonctionnalité nécessite le plan ${requiredPlan} ou supérieur.`);
    }
    return true;
  }
}
