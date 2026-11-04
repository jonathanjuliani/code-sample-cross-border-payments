import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/open.ts';
import { accountBalance } from '../ledger/balances.ts';
import type { SimRecords } from '../providers/sim/records.ts';

export function registerReconciliationRoute(
  app: FastifyInstance,
  deps: { db: Db; getRecords: () => SimRecords },
): void {
  const { db, getRecords } = deps;

  app.get('/reconciliation', async () => {
    const records = getRecords();
    const payouts = db
      .prepare(`SELECT id, convert_minor, receive_minor, status FROM payouts`)
      .all() as Array<{
      id: string;
      convert_minor: number;
      receive_minor: number;
      status: string;
    }>;

    let fxVarianceTotalMinor = 0;
    let networkFeeExpenseTotalMinor = 0;
    const items = [];

    for (const payout of payouts) {
      const mismatches: string[] = [];
      const fxVarianceMinor = accountBalance(db, payout.id, 'fx_variance', 'MXN');
      const networkFeeExpenseMinor = accountBalance(db, payout.id, 'network_fee_expense', 'USD');
      fxVarianceTotalMinor += fxVarianceMinor;
      networkFeeExpenseTotalMinor += networkFeeExpenseMinor;

      const collectRef = `${payout.id}-C1`;
      const transferRef = `${payout.id}-T1`;
      const depositRef = `${payout.id}-D1`;

      const collect = records.collect.get(collectRef);
      const chain = records.chain.get(transferRef);
      const offramp = records.offramp.get(depositRef);

      if (chain) {
        if (
          chain.convertMinor !== undefined &&
          chain.convertMinor !== payout.convert_minor &&
          chain.status === 'final'
        ) {
          mismatches.push(
            `chain convert ${chain.convertMinor} != payout convert ${payout.convert_minor}`,
          );
        }
        if (chain.amountMinor !== payout.convert_minor && chain.status === 'final') {
          mismatches.push(
            `chain amount ${chain.amountMinor} != payout convert ${payout.convert_minor}`,
          );
        }
      }

      if (offramp && offramp.status === 'succeeded') {
        const recipient = accountBalance(db, payout.id, 'recipient_bank', 'MXN');
        if (recipient !== payout.receive_minor) {
          mismatches.push(`recipient_bank MXN ${recipient} != receive ${payout.receive_minor}`);
        }
        if (
          offramp.amountMinor !== payout.convert_minor &&
          offramp.convertMinor !== payout.convert_minor
        ) {
          mismatches.push(
            `offramp amount ${offramp.amountMinor} != payout convert ${payout.convert_minor}`,
          );
        }
      }

      // Only list payouts that have sim activity or platform variance.
      if (
        mismatches.length > 0 ||
        fxVarianceMinor !== 0 ||
        networkFeeExpenseMinor !== 0 ||
        collect ||
        chain ||
        offramp
      ) {
        items.push({
          payoutId: payout.id,
          mismatches,
          fxVarianceMinor,
          networkFeeExpenseMinor,
        });
      }
    }

    return {
      items,
      totals: {
        fxVarianceMinor: fxVarianceTotalMinor,
        networkFeeExpenseMinor: networkFeeExpenseTotalMinor,
      },
    };
  });
}
