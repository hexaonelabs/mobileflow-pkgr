import { IsNotEmpty, IsString } from 'class-validator';

export class GenerateIosCertificateDto {
  @IsString()
  @IsNotEmpty()
  csrPem!: string;
}
