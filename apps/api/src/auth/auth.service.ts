import { ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { FieldValue } from 'firebase-admin/firestore';
import { BillingService } from '../billing/billing.service';
import { FirestoreService } from '../firestore/firestore.service';
import { AuthProvider, Plan, USERS_COLLECTION, type UserDocument } from '../users/user.model';
import type { RegisterDto } from './dto/register.dto';
import type { AuthenticatedUser } from './types/authenticated-user.type';
import type { JwtPayload } from './types/jwt-payload.type';

const SALT_ROUNDS = 12;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly firestore: FirestoreService,
    private readonly jwtService: JwtService,
    private readonly billingService: BillingService,
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
    await this.provisionBillingBestEffort(docRef.id, dto.email);
    return this.issueSession({
      id: docRef.id,
      email: dto.email,
      plan: Plan.free,
      githubInstallationId: null,
    });
  }

  async validateEmailPassword(email: string, password: string): Promise<AuthenticatedUser> {
    const snapshot = await this.users.where('email', '==', email).limit(1).get();
    const doc = snapshot.docs[0];
    const data = doc?.data() as UserDocument | undefined;
    if (!data?.passwordHash || !(await bcrypt.compare(password, data.passwordHash))) {
      throw new UnauthorizedException('Identifiants invalides.');
    }
    return {
      id: doc.id,
      email: data.email,
      plan: data.plan,
      githubInstallationId: data.githubInstallationId,
    };
  }

  async findOrCreateOAuthUser(email: string, provider: AuthProvider): Promise<AuthenticatedUser> {
    const snapshot = await this.users.where('email', '==', email).limit(1).get();
    if (!snapshot.empty) {
      const doc = snapshot.docs[0];
      const data = doc.data() as UserDocument;
      return {
        id: doc.id,
        email: data.email,
        plan: data.plan,
        githubInstallationId: data.githubInstallationId,
      };
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
    await this.provisionBillingBestEffort(docRef.id, email);
    return { id: docRef.id, email, plan: Plan.free, githubInstallationId: null };
  }

  issueSession(user: AuthenticatedUser) {
    const payload: JwtPayload = { sub: user.id, email: user.email };
    return {
      accessToken: this.jwtService.sign(payload),
      user,
    };
  }

  // Le Customer + Subscription Stripe (plan free à 0€) sont créés dès l'inscription pour
  // qu'un seul pipeline webhook gère tous les changements de plan par la suite. Un échec ici
  // ne doit pas bloquer l'inscription : BillingService.requireBilling() rattrape le
  // provisioning manquant au premier appel checkout/portal.
  private async provisionBillingBestEffort(userId: string, email: string): Promise<void> {
    try {
      await this.billingService.provisionCustomer(userId, email);
    } catch (error) {
      this.logger.warn(
        `Échec du provisioning Stripe pour l'utilisateur ${userId} (${email}), sera rattrapé au premier accès billing.`,
        error instanceof Error ? error.stack : error,
      );
    }
  }
}
