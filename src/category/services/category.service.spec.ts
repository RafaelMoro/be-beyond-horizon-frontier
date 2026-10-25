import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { UserService } from '../../user/services/user.service.js';
import { ALL_LOCAL_CATEGORIES } from '../category.constants.js';
import { Test, TestingModule } from '@nestjs/testing';
import { INITIAL_RESPONSE } from '../../constants.js';
import { Category } from '../entities/category.entity.js';
import { CategoryService } from './category.service.js';

const exec = (value: unknown) => ({ exec: vi.fn().mockResolvedValue(value) });
const SUB = '507f1f77bcf86cd799439011';
const CID = '64b7f0c2a1b2c3d4e5f60718';
const rejectsWith = async (
  p: Promise<unknown>,
  type: typeof BadRequestException | typeof NotFoundException,
  message: string,
) => {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(type);
  expect((err as Error).message).toBe(message);
};

describe('CategoryService', () => {
  let service: CategoryService;
  const model = {
    find: vi.fn(),
    create: vi.fn(),
    findOneAndUpdate: vi.fn(),
    findOneAndDelete: vi.fn(),
    exists: vi.fn(),
    insertMany: vi.fn(),
  };
  const session = { id: 'fake-session' };
  const connection = { transaction: vi.fn() };
  const userService = { findById: vi.fn() };

  beforeEach(async () => {
    vi.resetAllMocks();
    connection.transaction.mockImplementation(
      (fn: (s: unknown) => Promise<unknown>) => fn(session),
    );
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoryService,
        { provide: getModelToken(Category.name), useValue: model },
        { provide: getConnectionToken(), useValue: connection },
        { provide: UserService, useValue: userService },
      ],
    }).compile();

    service = module.get<CategoryService>(CategoryService);
  });

  describe('findByUser', () => {
    it('queries { sub } without the sub field and wraps the list', async () => {
      const categories = [{ categoryName: 'A' }];
      model.find.mockReturnValue(exec(categories));
      await expect(service.findByUser(SUB)).resolves.toStrictEqual({
        ...INITIAL_RESPONSE,
        data: { categories },
      });
      expect(model.find).toHaveBeenCalledWith({ sub: SUB }, { sub: 0 });
    });
  });

  describe('createCategory', () => {
    it('stores the given string sub and returns the created doc', async () => {
      const dto = { categoryName: 'A', subCategories: ['x'], icon: 'i' };
      const category = { ...dto, sub: SUB };
      model.create.mockResolvedValue(category);
      await expect(service.createCategory(SUB, dto)).resolves.toStrictEqual({
        ...INITIAL_RESPONSE,
        message: 'New category created',
        data: { category },
      });
      expect(model.create).toHaveBeenCalledWith({ ...dto, sub: SUB });
    });
  });

  describe('updateCategory', () => {
    it('filters by { _id, sub } and $sets only present, non-null fields', async () => {
      const category = { _id: CID, categoryName: 'New' };
      model.findOneAndUpdate.mockReturnValue(exec(category));
      const dto = {
        categoryId: CID,
        categoryName: 'New',
        icon: null,
      } as unknown as Parameters<CategoryService['updateCategory']>[1];
      await expect(service.updateCategory(SUB, dto)).resolves.toStrictEqual({
        ...INITIAL_RESPONSE,
        data: { category },
      });
      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: CID, sub: SUB },
        { $set: { categoryName: 'New' } },
        { returnDocument: 'after' },
      );
    });

    it('400 Category not found when nothing owned matches', async () => {
      model.findOneAndUpdate.mockReturnValue(exec(null));
      await rejectsWith(
        service.updateCategory(SUB, { categoryId: CID }),
        BadRequestException,
        'Category not found',
      );
    });
  });

  describe('deleteCategory', () => {
    it('filters by { _id, sub } and returns the deleted doc', async () => {
      const category = { _id: CID };
      model.findOneAndDelete.mockReturnValue(exec(category));
      await expect(
        service.deleteCategory(SUB, { categoryId: CID }),
      ).resolves.toStrictEqual({
        ...INITIAL_RESPONSE,
        message: 'Category deleted',
        data: { category },
      });
      expect(model.findOneAndDelete).toHaveBeenCalledWith({
        _id: CID,
        sub: SUB,
      });
    });

    it('400 Category not found when nothing owned matches', async () => {
      model.findOneAndDelete.mockReturnValue(exec(null));
      await rejectsWith(
        service.deleteCategory(SUB, { categoryId: CID }),
        BadRequestException,
        'Category not found',
      );
    });
  });

  describe('assertCategoryOwned', () => {
    it('404 for a non-ObjectId without querying', async () => {
      await rejectsWith(
        service.assertCategoryOwned('abc', SUB),
        NotFoundException,
        'Category not found',
      );
      expect(model.exists).not.toHaveBeenCalled();
    });

    it('404 when not owned', async () => {
      model.exists.mockReturnValue(exec(null));
      await rejectsWith(
        service.assertCategoryOwned(CID, SUB),
        NotFoundException,
        'Category not found',
      );
      expect(model.exists).toHaveBeenCalledWith({ _id: CID, sub: SUB });
    });

    it('resolves when owned', async () => {
      model.exists.mockReturnValue(exec({ _id: CID }));
      await expect(
        service.assertCategoryOwned(CID, SUB),
      ).resolves.toBeUndefined();
    });
  });

  describe('createLocalCategories', () => {
    const existsWith = (value: unknown) => ({
      session: vi.fn().mockResolvedValue(value),
    });

    it('400 for an unknown or invalid sub, without a transaction', async () => {
      userService.findById.mockResolvedValue(null);
      await rejectsWith(
        service.createLocalCategories('abc'),
        BadRequestException,
        'Local categories already exists',
      );
      expect(connection.transaction).not.toHaveBeenCalled();
      expect(model.insertMany).not.toHaveBeenCalled();
    });

    it('400 when the user already has categories, no insert', async () => {
      userService.findById.mockResolvedValue({ _id: new Types.ObjectId(SUB) });
      model.exists.mockReturnValue(existsWith({ _id: CID }));
      await rejectsWith(
        service.createLocalCategories(SUB),
        BadRequestException,
        'Local categories already exists',
      );
      expect(model.insertMany).not.toHaveBeenCalled();
    });

    it('seeds the 12 defaults under the stored id, inside the session', async () => {
      // Upper-case body sub: findById casts it, the stored sub is the canonical id string.
      userService.findById.mockResolvedValue({ _id: new Types.ObjectId(SUB) });
      const exists = existsWith(null);
      model.exists.mockReturnValue(exists);
      model.insertMany.mockImplementation(async (docs: unknown[]) => docs);
      const res = await service.createLocalCategories(SUB.toUpperCase());
      expect(model.exists).toHaveBeenCalledWith({ sub: SUB });
      expect(exists.session).toHaveBeenCalledWith(session);
      const [docs, opts] = model.insertMany.mock.calls[0];
      expect(opts).toStrictEqual({ session });
      expect(docs).toHaveLength(12);
      expect(
        docs.map((d: { categoryName: string }) => d.categoryName),
      ).toStrictEqual(ALL_LOCAL_CATEGORIES.map((c) => c.categoryName));
      expect(docs.every((d: { sub: string }) => d.sub === SUB)).toBe(true);
      expect(res).toStrictEqual({
        ...INITIAL_RESPONSE,
        message: 'New category created',
        data: { categories: docs },
      });
    });
  });
});
