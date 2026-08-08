import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import { Environment } from '../build.model';
import { Platform } from '../../projects/project.model';

export class CreateBuildDto {
  @IsEnum(Environment)
  environment!: Environment;

  @IsArray()
  @ArrayMinSize(1, { message: 'Au moins une plateforme doit être sélectionnée.' })
  @ArrayUnique()
  @IsEnum(Platform, { each: true })
  platforms!: Platform[];

  @IsString()
  @IsNotEmpty()
  branch!: string;

  @IsOptional()
  @IsObject()
  @Type(() => Object)
  envVars?: Record<string, string>;
}
