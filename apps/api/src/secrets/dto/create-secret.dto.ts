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

  // Ni un provisioning profile (.mobileprovision) ni une clé App Store Connect API (.p8) ne
  // sont protégés par un mot de passe.
  @ValidateIf(
    (dto: CreateSecretDto) =>
      dto.type !== SecretType.ios_provisioning_profile &&
      dto.type !== SecretType.app_store_connect_key,
  )
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

  // Identifiants de la clé App Store Connect API — cf. developer.apple.com > Users and Access >
  // Integrations. Requis uniquement pour app_store_connect_key ; fileBase64 porte le .p8.
  @ValidateIf((dto: CreateSecretDto) => dto.type === SecretType.app_store_connect_key)
  @IsString()
  @IsNotEmpty()
  issuerId?: string;

  @ValidateIf((dto: CreateSecretDto) => dto.type === SecretType.app_store_connect_key)
  @IsString()
  @IsNotEmpty()
  keyId?: string;
}
