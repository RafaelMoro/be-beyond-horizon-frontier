import { Type } from 'class-transformer';
import {
  IsArray,
  IsDate,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

// Develop's records.dto.ts: same decorators, same order. Q7: an optional `_id`, so old-next's edit echo passes.
export class IndebtedPeopleDto {
  @IsOptional()
  @IsMongoId()
  readonly _id?: string;

  @IsNotEmpty()
  readonly name: string;

  @IsNotEmpty()
  readonly amount: number;

  @IsNotEmpty()
  readonly amountPaid: number;

  @IsNotEmpty()
  readonly isPaid: boolean;
}

export class TransferRecordDto {
  @IsNotEmpty()
  readonly transferId: string;

  @IsNotEmpty()
  readonly account: string;
}

// The nested fields have no IsOptional (develop): omitted passes, null → 400.
export class CreateRecordDto {
  @IsString()
  @IsNotEmpty()
  readonly shortName: string;

  @IsString()
  @IsNotEmpty()
  readonly typeOfRecord: string;

  @IsString()
  readonly description: string;

  @IsNumber()
  @IsNotEmpty()
  readonly amount: number;

  @IsDate()
  @Type(() => Date)
  @IsNotEmpty()
  readonly date: Date;

  @IsMongoId()
  @IsNotEmpty()
  readonly category: string;

  @IsString()
  @IsNotEmpty()
  readonly subCategory: string;

  @IsArray()
  readonly tag: string[];

  @ValidateNested()
  @Type(() => IndebtedPeopleDto)
  readonly indebtedPeople: IndebtedPeopleDto[];

  @ValidateNested()
  @Type(() => TransferRecordDto)
  readonly transferRecord: TransferRecordDto;

  @IsMongoId()
  @IsNotEmpty()
  readonly account: string;

  @IsArray()
  readonly budgets: string[];
}

// Develop's PartialType(CreateRecordDto) + recordId, written by hand (like UpdateAccountDto).
export class UpdateRecordDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  readonly shortName?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  readonly typeOfRecord?: string;

  @IsOptional()
  @IsString()
  readonly description?: string;

  @IsOptional()
  @IsNumber()
  @IsNotEmpty()
  readonly amount?: number;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  @IsNotEmpty()
  readonly date?: Date;

  @IsOptional()
  @IsMongoId()
  @IsNotEmpty()
  readonly category?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  readonly subCategory?: string;

  @IsOptional()
  @IsArray()
  readonly tag?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => IndebtedPeopleDto)
  readonly indebtedPeople?: IndebtedPeopleDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => TransferRecordDto)
  readonly transferRecord?: TransferRecordDto;

  @IsOptional()
  @IsMongoId()
  @IsNotEmpty()
  readonly account?: string;

  @IsOptional()
  @IsArray()
  readonly budgets?: string[];

  @IsMongoId()
  @IsNotEmpty()
  readonly recordId: string;
}

export class DeleteRecordDto {
  @IsMongoId()
  @IsNotEmpty()
  readonly recordId: string;
}
