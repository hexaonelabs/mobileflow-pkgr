import { Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsBoolean, IsEnum, IsOptional, IsUrl, ValidateNested } from 'class-validator';
import { NotificationEvent } from '../notification-config.model';

class SlackConfigDto {
  @IsUrl()
  webhookUrl!: string;

  @IsBoolean()
  enabled!: boolean;

  @IsArray()
  @ArrayUnique()
  @IsEnum(NotificationEvent, { each: true })
  events!: NotificationEvent[];
}

export class UpsertNotificationConfigDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => SlackConfigDto)
  slack?: SlackConfigDto;
}
