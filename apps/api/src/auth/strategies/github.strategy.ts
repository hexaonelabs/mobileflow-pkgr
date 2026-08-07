import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy } from 'passport-github2';

@Injectable()
export class GithubStrategy extends PassportStrategy(Strategy, 'github') {
  constructor(configService: ConfigService) {
    super({
      clientID: configService.getOrThrow<string>('GITHUB_OAUTH_CLIENT_ID'),
      clientSecret: configService.getOrThrow<string>('GITHUB_OAUTH_CLIENT_SECRET'),
      callbackURL: configService.getOrThrow<string>('GITHUB_OAUTH_CALLBACK_URL'),
      scope: ['user:email'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: (err: Error | null, user?: { email: string }) => void,
  ) {
    const email = profile.emails?.[0]?.value;
    if (!email) {
      done(new Error('Aucun email public fourni par GitHub.'));
      return;
    }
    done(null, { email });
  }
}
