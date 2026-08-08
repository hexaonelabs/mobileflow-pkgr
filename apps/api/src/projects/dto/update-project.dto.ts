import { IsString, MinLength } from 'class-validator';

export class UpdateProjectDto {
  @IsString()
  @MinLength(1)
  name!: string;
}
