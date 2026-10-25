import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  interface ProvidedContext {
    mongoUri: string;
  }
}

// MONGO_TEST_URI (CI's docker replica set) wins; otherwise start a 1-node in-memory replica set.
export default async function setup(project: TestProject) {
  const replSet = process.env.MONGO_TEST_URI
    ? undefined
    : await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  project.provide('mongoUri', process.env.MONGO_TEST_URI ?? replSet!.getUri());
  return async () => {
    await replSet?.stop();
  };
}
