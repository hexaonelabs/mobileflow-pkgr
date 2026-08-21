import { IsEnum, IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';
import { Environment } from '../../builds/build.model';
import { SecretType } from '../secret.model';

export class CreateSecretDto {
  @IsEnum(SecretType)
  type!: SecretType;

  @IsString()
  @IsNotEmpty()
  fileName!: string;

  @IsString()
  @IsNotEmpty()
  fileBase64!: string;

  // Distingue staging (Ad Hoc) / production (App Store) — requis uniquement pour ce type,
  // cf. IOS_SIGNING_ENVIRONMENTS_PLAN.md.
  @ValidateIf((dto: CreateSecretDto) => dto.type === SecretType.ios_provisioning_profile)
  @IsEnum(Environment)
  environment?: Environment;

  // Un provisioning profile (.mobileprovision) n'est pas protégé par mot de passe.
  @ValidateIf((dto: CreateSecretDto) => dto.type !== SecretType.ios_provisioning_profile)
  @IsString()
  @IsNotEmpty()
  password?: string;

  @ValidateIf((dto: CreateSecretDto) => dto.type === SecretType.android_keystore)
  @IsString()
  @IsNotEmpty()
  alias?: string;

  @IsOptional()
  @IsString()
  keyPassword?: string;
}
