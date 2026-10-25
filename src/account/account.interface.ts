import type { ClientSession } from 'mongoose';

// Port for the records cascade on account delete; S7 (records) provides the real implementation.
export interface AccountRecordsCascade {
  deleteAccountRecords(args: {
    accountId: string;
    sub: string;
    session: ClientSession;
  }): Promise<{ numberExpensesDeleted: number; numberIncomesDeleted: number }>;
}
