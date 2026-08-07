import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AuthProvider } from '../users/user.model';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { GithubAuthGuard } from './guards/github-auth.guard';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { LocalAuthGuard } from './guards/local-auth.guard';
import type { AuthenticatedUser } from './types/authenticated-user.type';

type AuthenticatedRequest = Request & { user: AuthenticatedUser };
type OAuthRequest = Request & { user: { email: string } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @UseGuards(LocalAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Req() req: AuthenticatedRequest) {
    return this.authService.issueSession(req.user);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: AuthenticatedRequest) {
    return req.user;
  }

  @UseGuards(GoogleAuthGuard)
  @Get('oauth/google')
  googleLogin() {
    // La redirection vers Google est gérée par GoogleAuthGuard.
  }

  @UseGuards(GoogleAuthGuard)
  @Get('oauth/google/callback')
  async googleCallback(@Req() req: OAuthRequest, @Res() res: Response) {
    const user = await this.authService.findOrCreateOAuthUser(req.user.email, AuthProvider.google);
    this.redirectWithSession(res, user);
  }

  @UseGuards(GithubAuthGuard)
  @Get('oauth/github')
  githubLogin() {
    // La redirection vers GitHub est gérée par GithubAuthGuard.
  }

  @UseGuards(GithubAuthGuard)
  @Get('oauth/github/callback')
  async githubCallback(@Req() req: OAuthRequest, @Res() res: Response) {
    const user = await this.authService.findOrCreateOAuthUser(req.user.email, AuthProvider.github);
    this.redirectWithSession(res, user);
  }

  private redirectWithSession(res: Response, user: AuthenticatedUser) {
    const { accessToken } = this.authService.issueSession(user);
    const frontendUrl = this.configService.getOrThrow<string>('FRONTEND_URL');
    res.redirect(`${frontendUrl}/auth/callback?token=${accessToken}`);
  }
}
