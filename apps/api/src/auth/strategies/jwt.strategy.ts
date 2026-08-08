import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { FirestoreService } from '../../firestore/firestore.service';
import { USERS_COLLECTION, type UserDocument } from '../../users/user.model';
import type { AuthenticatedUser } from '../types/authenticated-user.type';
import type { JwtPayload } from '../types/jwt-payload.type';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly firestore: FirestoreService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const doc = await this.firestore.db.collection(USERS_COLLECTION).doc(payload.sub).get();
    if (!doc.exists) {
      throw new UnauthorizedException();
    }
    const data = doc.data() as UserDocument;
    return {
      id: doc.id,
      email: data.email,
      plan: data.plan,
      githubInstallationId: data.githubInstallationId,
    };
  }
}
