import { IsNotEmpty, IsString } from 'class-validator';

export class TriggerSetupDto {
  @IsString()
  @IsNotEmpty()
  webDir!: string;
}
