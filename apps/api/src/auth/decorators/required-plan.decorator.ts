import { SetMetadata } from '@nestjs/common';
import type { Plan } from '../../users/user.model';

export const REQUIRED_PLAN_KEY = 'requiredPlan';
export const RequirePlan = (plan: Plan) => SetMetadata(REQUIRED_PLAN_KEY, plan);
