import { IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  @Matches(/^[^/\s]+\/[^/\s]+$/, { message: 'Format attendu : "owner/repo".' })
  githubRepoFullName!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;
}
