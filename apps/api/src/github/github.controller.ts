import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { ConnectInstallationDto } from './dto/connect-installation.dto';
import { GITHUB_APP_REQUESTED_PERMISSIONS, GithubService } from './github.service';

type AuthenticatedRequest = Request & { user: AuthenticatedUser };

@UseGuards(JwtAuthGuard)
@Controller('github')
export class GithubController {
  constructor(private readonly githubService: GithubService) {}

  @Get('install-url')
  getInstallUrl() {
    return {
      url: this.githubService.getInstallUrl(),
      requestedPermissions: GITHUB_APP_REQUESTED_PERMISSIONS,
    };
  }

  @Post('callback')
  async connect(@Req() req: AuthenticatedRequest, @Body() dto: ConnectInstallationDto) {
    await this.githubService.connectInstallation(req.user.id, dto.installationId);
    return { connected: true };
  }

  @Get('repos')
  listRepos(@Req() req: AuthenticatedRequest) {
    return this.githubService.listRepos(req.user.id);
  }

  @Get('repos/:repo/branches')
  listBranches(@Req() req: AuthenticatedRequest, @Param('repo') repo: string) {
    return this.githubService.listBranches(req.user.id, repo);
  }

  @Get('repos/:repo/actions-quota')
  getActionsQuota(@Req() req: AuthenticatedRequest, @Param('repo') repo: string) {
    return this.githubService.getActionsQuota(req.user.id, repo);
  }
}
