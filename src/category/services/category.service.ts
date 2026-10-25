import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { type Connection, isValidObjectId, Model } from 'mongoose';
import { INITIAL_RESPONSE } from '../../constants.js';
import type { GeneralResponse } from '../../response.interface.js';
import {
  CATEGORY_CREATED_MESSAGE,
  CATEGORY_DELETED_MESSAGE,
  CATEGORY_NOT_FOUND_ERROR,
  LOCAL_CATEGORIES_EXISTS_ERROR,
  ALL_LOCAL_CATEGORIES,
} from '../category.constants.js';
import {
  CreateCategoryDto,
  DeleteCategoryDto,
  UpdateCategoryDto,
} from '../dtos/category.dto.js';
import { Category } from '../entities/category.entity.js';
import { UserService } from '../../user/services/user.service.js';

const UPDATABLE_FIELDS = ['categoryName', 'subCategories', 'icon'] as const;

// Responses carry the hydrated docs (Nest serializes them through toJSON: `_id`, `__v`), as legacy did.
// No try/catch: mongoose ValidationError/CastError → 400 and anything else → 500 via the global filters.
@Injectable()
export class CategoryService {
  constructor(
    @InjectModel(Category.name) private readonly categoryModel: Model<Category>,
    @InjectConnection() private readonly connection: Connection,
    private readonly userService: UserService,
  ) {}

  async findByUser(sub: string): Promise<GeneralResponse> {
    const categories = await this.categoryModel
      .find({ sub }, { sub: 0 })
      .exec();
    return { ...INITIAL_RESPONSE, data: { categories } };
  }

  async createCategory(
    sub: string,
    dto: CreateCategoryDto,
  ): Promise<GeneralResponse> {
    const category = await this.categoryModel.create({ ...dto, sub });
    return {
      ...INITIAL_RESPONSE,
      message: CATEGORY_CREATED_MESSAGE,
      data: { category },
    };
  }

  // Filtered by owner: someone else's id answers exactly like a missing one.
  async updateCategory(
    sub: string,
    dto: UpdateCategoryDto,
  ): Promise<GeneralResponse> {
    // IsOptional lets null through: only present, non-null fields are written; never categoryId or sub.
    const $set = Object.fromEntries(
      UPDATABLE_FIELDS.filter((f) => dto[f] != null).map((f) => [f, dto[f]]),
    );
    const category = await this.categoryModel
      .findOneAndUpdate(
        { _id: dto.categoryId, sub },
        { $set },
        { returnDocument: 'after' },
      )
      .exec();
    if (!category) throw new BadRequestException(CATEGORY_NOT_FOUND_ERROR);
    return { ...INITIAL_RESPONSE, data: { category } };
  }

  // Records pointing at the category are left as they are (legacy).
  async deleteCategory(
    sub: string,
    { categoryId }: DeleteCategoryDto,
  ): Promise<GeneralResponse> {
    const category = await this.categoryModel
      .findOneAndDelete({ _id: categoryId, sub })
      .exec();
    if (!category) throw new BadRequestException(CATEGORY_NOT_FOUND_ERROR);
    return {
      ...INITIAL_RESPONSE,
      message: CATEGORY_DELETED_MESSAGE,
      data: { category },
    };
  }

  // For S7 (records): 404 is legacy validateCategoryExists's form; S7 maps its transfer case to 400 itself.
  async assertCategoryOwned(categoryId: string, sub: string): Promise<void> {
    if (
      !isValidObjectId(categoryId) ||
      !(await this.categoryModel.exists({ _id: categoryId, sub }).exec())
    ) {
      throw new NotFoundException(CATEGORY_NOT_FOUND_ERROR);
    }
  }

  // Public route: the body sub is untrusted. Seeds only an existing user with no categories, under the stored id.
  async createLocalCategories(bodySub: string): Promise<GeneralResponse> {
    const user = await this.userService.findById(bodySub);
    if (!user) throw new BadRequestException(LOCAL_CATEGORIES_EXISTS_ERROR);
    const sub = user._id.toString();
    // The check sits inside so a retried transaction re-checks. Two concurrent first seeds can both commit
    // (accepted, C3).
    const categories = await this.connection.transaction(async (session) => {
      if (await this.categoryModel.exists({ sub }).session(session)) {
        throw new BadRequestException(LOCAL_CATEGORIES_EXISTS_ERROR);
      }
      return this.categoryModel.insertMany(
        ALL_LOCAL_CATEGORIES.map((c) => ({ ...c, sub })),
        { session },
      );
    });
    return {
      ...INITIAL_RESPONSE,
      message: CATEGORY_CREATED_MESSAGE,
      data: { categories },
    };
  }
}
