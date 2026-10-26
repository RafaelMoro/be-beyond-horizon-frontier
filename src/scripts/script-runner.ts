import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { parseArgs } from 'node:util';

// Operator scripts (S8b): run by the owner from the repo root after `pnpm run build`; never imported by the app.

export interface ScriptArgs {
  apply: boolean;
  db?: string;
  r4Map?: string;
}

export interface ScriptOptions {
  apply: boolean;
  r4Map?: string;
  log: (line: string) => void;
}

export type ScriptRun = (
  app: INestApplicationContext,
  opts: ScriptOptions,
) => Promise<boolean>;

export function parseScriptArgs(argv: string[]): ScriptArgs {
  const { values, tokens } = parseArgs({
    args: argv,
    options: {
      apply: { type: 'boolean', default: false },
      db: { type: 'string' },
      'r4-map': { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
    tokens: true,
  });
  // A stray `--` (e.g. `pnpm run x -- --apply`) would end option parsing silently.
  if (tokens.some((t) => t.kind === 'option-terminator')) {
    throw new Error("Unexpected '--': pass the flags directly");
  }
  return { apply: values.apply, db: values.db, r4Map: values['r4-map'] };
}

export function assertApplyTarget(args: ScriptArgs, dbName: string): boolean {
  return !args.apply || args.db === dbName;
}

// AppModule: same ConfigModule (.env + Joi), mongooseOptions (prod-DB guard under test) and models; no HTTP listener.
// Imported lazily so the arg helpers (and their spec) don't load the app or read .env.
export async function createScriptContext(): Promise<INestApplicationContext> {
  const { AppModule } = await import('../app.module.js');
  return NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
    abortOnError: false,
  });
}

// Only name + code: Mongo messages can carry key values (E11000) or hosts.
export function errorLabel(error: unknown): string {
  const { name, code } = (error ?? {}) as { name?: string; code?: unknown };
  return code === undefined ? `${name}` : `${name} ${code}`;
}

export async function runScript(run: ScriptRun): Promise<void> {
  let args: ScriptArgs;
  try {
    args = parseScriptArgs(process.argv.slice(2));
  } catch (error) {
    // Parse errors only echo argv.
    console.error(`error: ${(error as Error).message}`);
    process.exitCode = 1;
    return;
  }
  if (args.apply && !args.db) {
    console.error(
      'refused: --apply needs --db=<the db name printed on the dry-run target line>',
    );
    process.exitCode = 1;
    return;
  }
  let app: INestApplicationContext | undefined;
  try {
    app = await createScriptContext();
    const connection = app.get<Connection>(getConnectionToken());
    // The parsed host, never the URI: no credentials in the output.
    console.log(
      `target: ${connection.host} db=${connection.name} mode=${args.apply ? 'apply' : 'dry-run'}`,
    );
    if (!assertApplyTarget(args, connection.name)) {
      console.error(`refused: --db does not match the connected db`);
      process.exitCode = 1;
      return;
    }
    const ok = await run(app, {
      apply: args.apply,
      r4Map: args.r4Map,
      log: console.log,
    });
    if (!ok) process.exitCode = 1;
  } catch (error) {
    console.error(`error: ${errorLabel(error)}`);
    process.exitCode = 1;
  } finally {
    await app?.close();
  }
}
