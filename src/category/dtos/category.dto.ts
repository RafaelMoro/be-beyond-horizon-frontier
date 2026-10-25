import {
  IsArray,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

// Legacy CreateCategoriesDto: same decorators, same order.
export class CreateCategoryDto {
  @IsString()
  @IsNotEmpty()
  readonly categoryName: string;

  // `[]` passes (legacy).
  @IsArray()
  @IsNotEmpty()
  readonly subCategories: string[];

  @IsString()
  @IsNotEmpty()
  readonly icon: string;
}

// Legacy UpdateCategoriesDto (PartialType of create), written by hand.
export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  readonly categoryName?: string;

  @IsOptional()
  @IsArray()
  @IsNotEmpty()
  readonly subCategories?: string[];

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  readonly icon?: string;

  @IsMongoId()
  @IsNotEmpty()
  readonly categoryId: string;
}

export class DeleteCategoryDto {
  @IsMongoId()
  @IsNotEmpty()
  readonly categoryId: string;
}

// No IsMongoId: keeps the legacy validation messages; the service treats a non-ObjectId as an unknown user.
export class CreateLocalCategoriesDto {
  @IsString()
  @IsNotEmpty()
  readonly sub: string;
}
