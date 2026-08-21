import { IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateProjectDto {
  @IsString()
  @MinLength(1)
  name!: string;

  // omis/undefined = ne change rien, null = désactive l'auto-trigger, string = branche cible.
  @IsOptional()
  @IsString()
  autoTriggerBranch?: string | null;
}
