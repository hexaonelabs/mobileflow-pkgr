import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { FieldValue } from 'firebase-admin/firestore';
import { FirestoreService } from '../firestore/firestore.service';
import { AuthProvider, Plan, USERS_COLLECTION, type UserDocument } from '../users/user.model';
import type { RegisterDto } from './dto/register.dto';
import type { AuthenticatedUser } from './types/authenticated-user.type';
import type { JwtPayload } from './types/jwt-payload.type';

const SALT_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly jwtService: JwtService,
  ) {}

  private get users() {
    return this.firestore.db.collection(USERS_COLLECTION);
  }

  async register(dto: RegisterDto) {
    const existing = await this.users.where('email', '==', dto.email).limit(1).get();
    if (!existing.empty) {
      throw new ConflictException('Un compte existe déjà avec cet email.');
    }
    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const now = FieldValue.serverTimestamp();
    const doc: UserDocument = {
      email: dto.email,
      authProvider: AuthProvider.email,
      passwordHash,
      githubInstallationId: null,
      plan: Plan.free,
      createdAt: now,
      updatedAt: now,
    };
    const docRef = await this.users.add(doc);
    return this.issueSession({ id: docRef.id, email: dto.email, plan: Plan.free });
  }

  async validateEmailPassword(email: string, password: string): Promise<AuthenticatedUser> {
    const snapshot = await this.users.where('email', '==', email).limit(1).get();
    const doc = snapshot.docs[0];
    const data = doc?.data() as UserDocument | undefined;
    if (!data?.passwordHash || !(await bcrypt.compare(password, data.passwordHash))) {
      throw new UnauthorizedException('Identifiants invalides.');
    }
    return { id: doc.id, email: data.email, plan: data.plan };
  }

  async findOrCreateOAuthUser(email: string, provider: AuthProvider): Promise<AuthenticatedUser> {
    const snapshot = await this.users.where('email', '==', email).limit(1).get();
    if (!snapshot.empty) {
      const doc = snapshot.docs[0];
      const data = doc.data() as UserDocument;
      return { id: doc.id, email: data.email, plan: data.plan };
    }
    const now = FieldValue.serverTimestamp();
    const doc: UserDocument = {
      email,
      authProvider: provider,
      passwordHash: null,
      githubInstallationId: null,
      plan: Plan.free,
      createdAt: now,
      updatedAt: now,
    };
    const docRef = await this.users.add(doc);
    return { id: docRef.id, email, plan: Plan.free };
  }

  issueSession(user: AuthenticatedUser) {
    const payload: JwtPayload = { sub: user.id, email: user.email };
    return {
      accessToken: this.jwtService.sign(payload),
      user,
    };
  }
}
