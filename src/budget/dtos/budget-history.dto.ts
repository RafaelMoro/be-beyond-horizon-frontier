import { Type } from 'class-transformer';
import {
  IsArray,
  IsDate,
  IsDefined,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

// Develop's DTOs (src/budget-history/budget-history.dto.ts): same decorators, same order.
export class RecordsHistoryDto {
  @IsString()
  @IsNotEmpty()
  readonly recordId: string;

  @IsString()
  @IsNotEmpty()
  readonly recordName: string;

  @IsDate()
  @Type(() => Date)
  @IsNotEmpty()
  readonly recordDate: Date;

  @IsNumber()
  @IsNotEmpty()
  readonly recordAmount: number;

  @IsNumber()
  @IsNotEmpty()
  readonly budgetCurrentAmount: number;

  @IsNumber()
  @IsNotEmpty()
  readonly budgetUpdatedAmount: number;
}

export class CreateBudgetHistoryDto {
  @IsNotEmpty()
  @IsString()
  readonly budget: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecordsHistoryDto)
  readonly records: RecordsHistoryDto[];
}

// Develop's PartialType of create, written by hand.
export class UpdateBudgetHistoryDto {
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  readonly budget?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecordsHistoryDto)
  readonly records?: RecordsHistoryDto[];

  @IsMongoId()
  @IsNotEmpty()
  readonly budgetHistoryId: string;
}

export class DeleteBudgetHistoryDto {
  @IsMongoId()
  @IsNotEmpty()
  readonly budgetHistoryId: string;
}

export class AddRecordToBudgetHistoryDto {
  @IsMongoId()
  @IsNotEmpty()
  readonly budgetId: string;

  // A single object: class-validator ignores `each` on non-iterables (develop). IsDefined is ours: without it a
  // missing record passed validation (201) and reached the $push.
  @IsDefined()
  @ValidateNested({ each: true })
  @Type(() => RecordsHistoryDto)
  readonly record: RecordsHistoryDto;
}

export class RemoveRecordFromBudgetHistoryDto {
  @IsMongoId()
  @IsNotEmpty()
  readonly budgetId: string;

  @IsMongoId()
  readonly record: string;
}
