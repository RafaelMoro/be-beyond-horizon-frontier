import { INestApplication, Logger } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Category } from '../src/category/entities/category.entity.js';
import { INITIAL_RESPONSE } from '../src/constants.js';
import { closeTestApp, createTestApp } from './create-test-app.js';

const PASSWORD = 'e2e-password';
let seq = 0;
const uniqueEmail = () => `e2e-cat-${Date.now()}-${seq++}@example.invalid`;
const unauthorized = {
  ...INITIAL_RESPONSE,
  success: false,
  error: { message: 'Unauthorized', statusCode: 401 },
};
const badRequest = (message: string | string[]) => ({
  ...INITIAL_RESPONSE,
  success: false,
  error: { message, error: 'Bad Request', statusCode: 400 },
});
const newCategory = (categoryName = 'Mine') => ({
  categoryName,
  subCategories: ['a', 'b'],
  icon: 'newCategory',
});

describe('Categories (e2e)', () => {
  let app: INestApplication<App>;
  let categoryModel: Model<Category>;
  const http = () => request(app.getHttpServer());

  // Same signup + login as auth-users.e2e-spec.ts; the token is the cookie value, sent as Bearer.
  const signupAndLogin = async () => {
    const email = uniqueEmail();
    const res = await http()
      .post('/users')
      .send({
        email,
        password: PASSWORD,
        firstName: 'First',
        lastName: 'Last',
        middleName: '',
      })
      .expect(201);
    const login = await http()
      .post('/auth/')
      .send({ email, password: PASSWORD })
      .expect(201);
    const cookie = (login.headers['set-cookie'] as unknown as string[])[0];
    const token = cookie.slice(cookie.indexOf('=') + 1, cookie.indexOf(';'));
    return {
      sub: res.body.data.userCreated.sub as string,
      auth: { Authorization: `Bearer ${token}` },
    };
  };

  beforeAll(async () => {
    app = await createTestApp();
    categoryModel = app.get<Model<Category>>(getModelToken(Category.name));
    // Collection + index creation must not race the first transaction.
    await categoryModel.init();
  });

  afterAll(async () => {
    if (app) await closeTestApp(app);
  });

  afterEach(() => vi.restoreAllMocks());

  describe('GET /categories', () => {
    it('401 without a token', async () => {
      const res = await http().get('/categories').expect(401);
      expect(res.body).toStrictEqual(unauthorized);
    });

    it('200 with an empty list for a fresh user', async () => {
      const { auth } = await signupAndLogin();
      const res = await http().get('/categories').set(auth).expect(200);
      expect(res.body).toStrictEqual({
        ...INITIAL_RESPONSE,
        data: { categories: [] },
      });
    });
  });

  describe('POST /categories', () => {
    it('201 with the created doc, then GET lists it without sub', async () => {
      const { sub, auth } = await signupAndLogin();
      const body = newCategory();
      const res = await http()
        .post('/categories')
        .set(auth)
        .send(body)
        .expect(201);
      expect(res.body).toStrictEqual({
        ...INITIAL_RESPONSE,
        message: 'New category created',
        data: {
          category: {
            _id: expect.any(String),
            ...body,
            sub,
            __v: 0,
          },
        },
      });
      const list = await http().get('/categories').set(auth).expect(200);
      expect(list.body.data.categories).toStrictEqual([
        { _id: res.body.data.category._id, ...body, __v: 0 },
      ]);
    });

    it('accepts an empty subCategories array', async () => {
      const { auth } = await signupAndLogin();
      await http()
        .post('/categories')
        .set(auth)
        .send({ ...newCategory(), subCategories: [] })
        .expect(201);
    });

    it('400 with the legacy validation message when icon is missing', async () => {
      const { auth } = await signupAndLogin();
      const res = await http()
        .post('/categories')
        .set(auth)
        .send({ categoryName: 'X', subCategories: ['a'] })
        .expect(400);
      expect(res.body).toStrictEqual(
        badRequest(['icon should not be empty', 'icon must be a string']),
      );
    });

    it('400 for an unknown body key (sub)', async () => {
      const { auth } = await signupAndLogin();
      const res = await http()
        .post('/categories')
        .set(auth)
        .send({ ...newCategory(), sub: 'someone-else' })
        .expect(400);
      expect(res.body).toStrictEqual(
        badRequest(['property sub should not exist']),
      );
    });

    it("another user's GET does not see it", async () => {
      const a = await signupAndLogin();
      const b = await signupAndLogin();
      await http().post('/categories').set(a.auth).send(newCategory());
      const res = await http().get('/categories').set(b.auth).expect(200);
      expect(res.body.data.categories).toStrictEqual([]);
    });
  });

  describe('PUT / DELETE /categories', () => {
    const UNUSED_ID = '000000000000000000000000';
    const notFound = badRequest('Category not found');
    const createFor = async (auth: Record<string, string>, name = 'Mine') => {
      const res = await http()
        .post('/categories')
        .set(auth)
        .send(newCategory(name))
        .expect(201);
      return res.body.data.category as Record<string, unknown> & {
        _id: string;
      };
    };

    it("another user's PUT and DELETE get the missing-id 400 and change nothing", async () => {
      const a = await signupAndLogin();
      const b = await signupAndLogin();
      const created = await createFor(a.auth);
      const missing = await http()
        .put('/categories')
        .set(b.auth)
        .send({ categoryId: UNUSED_ID, categoryName: 'Hacked' })
        .expect(400);
      expect(missing.body).toStrictEqual(notFound);
      const put = await http()
        .put('/categories')
        .set(b.auth)
        .send({ categoryId: created._id, categoryName: 'Hacked' })
        .expect(400);
      expect(put.body).toStrictEqual(missing.body);
      const del = await http()
        .delete('/categories')
        .set(b.auth)
        .send({ categoryId: created._id })
        .expect(400);
      expect(del.body).toStrictEqual(notFound);
      const list = await http().get('/categories').set(a.auth).expect(200);
      const { sub: _sub, ...withoutSub } = created;
      expect(list.body.data.categories).toStrictEqual([withoutSub]);
    });

    it("the owner's PUT updates, a bare categoryId changes nothing", async () => {
      const { sub, auth } = await signupAndLogin();
      const created = await createFor(auth);
      const res = await http()
        .put('/categories')
        .set(auth)
        .send({ categoryId: created._id, categoryName: 'Renamed' })
        .expect(200);
      expect(res.body).toStrictEqual({
        ...INITIAL_RESPONSE,
        data: { category: { ...created, categoryName: 'Renamed', sub } },
      });
      const bare = await http()
        .put('/categories')
        .set(auth)
        .send({ categoryId: created._id })
        .expect(200);
      expect(bare.body.data.category).toStrictEqual(res.body.data.category);
    });

    it('PUT 400 for a sub key or a non-ObjectId categoryId', async () => {
      const { auth } = await signupAndLogin();
      const created = await createFor(auth);
      const withSub = await http()
        .put('/categories')
        .set(auth)
        .send({ categoryId: created._id, sub: 'x' })
        .expect(400);
      expect(withSub.body).toStrictEqual(
        badRequest(['property sub should not exist']),
      );
      const badId = await http()
        .put('/categories')
        .set(auth)
        .send({ categoryId: 'abc' })
        .expect(400);
      expect(badId.body).toStrictEqual(
        badRequest(['categoryId must be a mongodb id']),
      );
    });

    it("the owner's DELETE returns the doc, a second one 400s", async () => {
      const { auth } = await signupAndLogin();
      const created = await createFor(auth);
      const res = await http()
        .delete('/categories')
        .set(auth)
        .send({ categoryId: created._id })
        .expect(200);
      expect(res.body).toStrictEqual({
        ...INITIAL_RESPONSE,
        message: 'Category deleted',
        data: { category: created },
      });
      const again = await http()
        .delete('/categories')
        .set(auth)
        .send({ categoryId: created._id })
        .expect(400);
      expect(again.body).toStrictEqual(notFound);
    });

    it('DELETE 401 without a token', async () => {
      const res = await http()
        .delete('/categories')
        .send({ categoryId: UNUSED_ID })
        .expect(401);
      expect(res.body).toStrictEqual(unauthorized);
    });
  });

  describe('POST /categories/create-local-categories', () => {
    const seed = (sub: unknown) =>
      http().post('/categories/create-local-categories').send({ sub });
    const exists = badRequest('Local categories already exists');

    it('201 without a token: 12 defaults under the user id, then GET lists them', async () => {
      const { sub, auth } = await signupAndLogin();
      const res = await seed(sub).expect(201);
      const { categories } = res.body.data;
      expect(res.body).toStrictEqual({
        ...INITIAL_RESPONSE,
        message: 'New category created',
        data: { categories },
      });
      expect(categories).toHaveLength(12);
      expect(categories.every((c: { sub: string }) => c.sub === sub)).toBe(
        true,
      );
      expect(categories[0].categoryName).toBe('Comida y Bebida');
      expect(categories[11].categoryName).toBe('Ingreso');
      expect(
        categories.find((c: { icon: string }) => c.icon === 'savings')
          .subCategories,
      ).toContain('Automóvil / Propiedad inmobiliaria ');
      const list = await http().get('/categories').set(auth).expect(200);
      expect(list.body.data.categories).toHaveLength(12);
      expect(list.body.data.categories[0]).not.toHaveProperty('sub');
    });

    it('stores the canonical id for an upper-case sub', async () => {
      const { sub } = await signupAndLogin();
      const res = await seed(sub.toUpperCase()).expect(201);
      expect(res.body.data.categories[0].sub).toBe(sub);
    });

    it('400 on a second seed, and for a user with a POSTed category', async () => {
      const a = await signupAndLogin();
      await seed(a.sub).expect(201);
      expect((await seed(a.sub).expect(400)).body).toStrictEqual(exists);
      expect(await categoryModel.countDocuments({ sub: a.sub })).toBe(12);

      const b = await signupAndLogin();
      await http().post('/categories').set(b.auth).send(newCategory());
      expect((await seed(b.sub).expect(400)).body).toStrictEqual(exists);
      expect(await categoryModel.countDocuments({ sub: b.sub })).toBe(1);
    });

    it('400 with no write for an unknown or non-ObjectId sub', async () => {
      for (const sub of ['000000000000000000000000', 'abc']) {
        expect((await seed(sub).expect(400)).body).toStrictEqual(exists);
        expect(await categoryModel.countDocuments({ sub })).toBe(0);
      }
    });

    it('400 validation for a missing, empty or non-string sub, or an extra key', async () => {
      await http()
        .post('/categories/create-local-categories')
        .send({})
        .expect(400);
      await seed('').expect(400);
      const nonString = await seed(1).expect(400);
      expect(nonString.body).toStrictEqual(
        badRequest(['sub must be a string']),
      );
      await http()
        .post('/categories/create-local-categories')
        .send({ sub: 'abc', extra: 1 })
        .expect(400);
    });

    it('rolls back a partial insert (transaction + session passed)', async () => {
      const { sub } = await signupAndLogin();
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      const original = categoryModel.insertMany.bind(categoryModel);
      vi.spyOn(categoryModel, 'insertMany').mockImplementationOnce((async (
        docs: unknown[],
        opts: object,
      ) => {
        await original(docs.slice(0, 6), opts);
        throw new Error('boom');
      }) as never);
      const res = await seed(sub).expect(500);
      expect(res.body).toStrictEqual({
        ...INITIAL_RESPONSE,
        success: false,
        error: { statusCode: 500, message: 'Internal server error' },
      });
      expect(await categoryModel.countDocuments({ sub })).toBe(0);
      vi.restoreAllMocks();
      expect((await seed(sub).expect(201)).body.data.categories).toHaveLength(
        12,
      );
    });
  });
});
