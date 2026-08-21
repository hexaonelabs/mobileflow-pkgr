import { IsIn } from 'class-validator';
import { Plan } from '../../users/user.model';

export class CreateCheckoutSessionDto {
  @IsIn([Plan.starter])
  targetPlan!: typeof Plan.starter;
}
