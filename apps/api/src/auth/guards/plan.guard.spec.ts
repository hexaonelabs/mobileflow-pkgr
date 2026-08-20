import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { PlanGuard } from './plan.guard';
import { REQUIRED_PLAN_KEY } from '../decorators/required-plan.decorator';
import { Plan } from '../../users/user.model';

function createContext(userPlan?: Plan): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: userPlan ? { plan: userPlan } : undefined }),
    }),
    getHandler: () => ({}),
  } as unknown as ExecutionContext;
}

describe('PlanGuard', () => {
  function createGuard(requiredPlan: Plan | undefined) {
    const reflector = { get: jest.fn().mockReturnValue(requiredPlan) } as unknown as Reflector;
    return new PlanGuard(reflector);
  }

  it('allows the request when the handler has no @RequirePlan metadata', () => {
    const guard = createGuard(undefined);
    expect(guard.canActivate(createContext(Plan.free))).toBe(true);
  });

  it('allows the request when the user plan meets the required level', () => {
    const guard = createGuard(Plan.starter);
    expect(guard.canActivate(createContext(Plan.pro))).toBe(true);
  });

  it('allows the request when the user plan exactly matches the required level', () => {
    const guard = createGuard(Plan.starter);
    expect(guard.canActivate(createContext(Plan.starter))).toBe(true);
  });

  it('rejects the request when the user plan is below the required level', () => {
    const guard = createGuard(Plan.starter);
    expect(() => guard.canActivate(createContext(Plan.free))).toThrow(ForbiddenException);
  });

  it('treats a missing user plan as free', () => {
    const guard = createGuard(Plan.starter);
    expect(() => guard.canActivate(createContext(undefined))).toThrow(ForbiddenException);
  });

  it('uses the metadata key expected by @RequirePlan', () => {
    const reflector = { get: jest.fn().mockReturnValue(undefined) } as unknown as Reflector;
    const guard = new PlanGuard(reflector);
    guard.canActivate(createContext(Plan.free));
    expect(reflector.get).toHaveBeenCalledWith(REQUIRED_PLAN_KEY, expect.anything());
  });
});
