import { IsArray, IsBoolean, IsMongoId, IsOptional } from 'class-validator';
import {
  CreateRecordDto,
  DeleteRecordDto,
  UpdateRecordDto,
} from './record.dto.js';

// Elements are validated here (research §14: a bad element was already a CastError 400 in legacy).
export class CreateExpenseDto extends CreateRecordDto {
  @IsBoolean()
  readonly isPaid: boolean;

  @IsArray()
  @IsMongoId({ each: true })
  readonly linkedBudgets: string[];
}

export class UpdateExpenseDto extends UpdateRecordDto {
  @IsOptional()
  @IsBoolean()
  readonly isPaid?: boolean;

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  readonly linkedBudgets?: string[];
}

export { DeleteRecordDto as DeleteExpenseDto };
