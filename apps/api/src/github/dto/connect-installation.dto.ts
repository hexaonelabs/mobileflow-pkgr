import { IsNotEmpty, IsString } from 'class-validator';

export class ConnectInstallationDto {
  @IsString()
  @IsNotEmpty()
  installationId!: string;
}
