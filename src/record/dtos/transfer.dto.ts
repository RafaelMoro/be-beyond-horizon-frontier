import { Type } from 'class-transformer';
import { IsNotEmpty, ValidateNested } from 'class-validator';
import { CreateExpenseDto } from './expense.dto.js';
import { CreateIncomeDto } from './income.dto.js';

// develop's transfer.dto.ts. Nested whitelisting keeps key presence: isPaid on the income → 400.
export class CreateTransferDto {
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => CreateExpenseDto)
  readonly expense: CreateExpenseDto;

  @IsNotEmpty()
  @ValidateNested()
  @Type(() => CreateIncomeDto)
  readonly income: CreateIncomeDto;
}
