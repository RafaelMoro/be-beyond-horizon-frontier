import { IsArray, IsOptional } from 'class-validator';
import {
  CreateRecordDto,
  DeleteRecordDto,
  UpdateRecordDto,
} from './record.dto.js';

// Elements (ids or echoed expense objects) are checked by toExpenseIds; no ValidateNested, so the whitelist leaves
// the echoed objects alone. No isPaid/linkedBudgets: forbidNonWhitelisted 400s them, as develop.
export class CreateIncomeDto extends CreateRecordDto {
  @IsArray()
  readonly expensesPaid: unknown[];
}

// Q8: omitted = the paid flags and the stored list stay as they are.
export class UpdateIncomeDto extends UpdateRecordDto {
  @IsOptional()
  @IsArray()
  readonly expensesPaid?: unknown[];
}

export { DeleteRecordDto as DeleteIncomeDto };
