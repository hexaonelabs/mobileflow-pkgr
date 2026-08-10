import { IsEnum, IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';
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
