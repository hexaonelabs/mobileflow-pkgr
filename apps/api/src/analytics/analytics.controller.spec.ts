import { AnalyticsController } from './analytics.controller';
import type { AnalyticsService } from './analytics.service';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';

function createAnalyticsService() {
  return {
    getSummary: jest.fn().mockResolvedValue({ totalBuilds: 1 }),
    getTrends: jest.fn().mockResolvedValue({ months: [] }),
    getBreakdown: jest.fn().mockResolvedValue({ platform: {}, environment: {} }),
  };
}

function requestFor(user: AuthenticatedUser) {
  return { user } as unknown as Request & { user: AuthenticatedUser };
}

describe('AnalyticsController', () => {
  const user = { id: 'user1', email: 'a@b.com', plan: 'free' } as unknown as AuthenticatedUser;

  it('getSummary delegates to AnalyticsService.getSummary with the authenticated user id', async () => {
    const analyticsService = createAnalyticsService();
    const controller = new AnalyticsController(analyticsService as unknown as AnalyticsService);

    const result = await controller.getSummary(requestFor(user), 'proj1');

    expect(analyticsService.getSummary).toHaveBeenCalledWith('user1', 'proj1');
    expect(result).toEqual({ totalBuilds: 1 });
  });

  it('getTrends delegates to AnalyticsService.getTrends', async () => {
    const analyticsService = createAnalyticsService();
    const controller = new AnalyticsController(analyticsService as unknown as AnalyticsService);

    await controller.getTrends(requestFor(user), 'proj1');

    expect(analyticsService.getTrends).toHaveBeenCalledWith('user1', 'proj1');
  });

  it('getBreakdown delegates to AnalyticsService.getBreakdown', async () => {
    const analyticsService = createAnalyticsService();
    const controller = new AnalyticsController(analyticsService as unknown as AnalyticsService);

    await controller.getBreakdown(requestFor(user), 'proj1');

    expect(analyticsService.getBreakdown).toHaveBeenCalledWith('user1', 'proj1');
  });
});
