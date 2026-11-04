import type { FastifyBaseLogger } from 'fastify';
import type { Clock } from '../clock.ts';
import type { Db } from '../db/open.ts';
import { type JournalLeg, postJournal } from './post.ts';

export type PayoutAmounts = {
  id: string;
  send_minor: number;
  fee_minor: number;
  convert_minor: number;
  receive_minor: number;
};

export function onCollectSucceeded(
  db: Db,
  clock: Clock,
  log: FastifyBaseLogger,
  payout: PayoutAmounts,
): void {
  postJournal(db, clock, log, payout.id, 'collect succeeded', [
    {
      currency: 'USD',
      from: 'sender_bank',
      to: 'usd_clearing',
      amountMinor: payout.send_minor,
    },
    {
      currency: 'USD',
      from: 'usd_clearing',
      to: 'fee_revenue',
      amountMinor: payout.fee_minor,
    },
    {
      currency: 'USD',
      from: 'usd_clearing',
      to: 'onramp',
      amountMinor: payout.convert_minor,
    },
    {
      currency: 'DUSD',
      from: 'onramp',
      to: 'treasury_wallet',
      amountMinor: payout.convert_minor,
    },
  ]);
}

export function onTransferFinal(
  db: Db,
  clock: Clock,
  log: FastifyBaseLogger,
  payout: PayoutAmounts,
  networkFeeMinor = 0,
): void {
  const entries: JournalLeg[] = [
    {
      currency: 'DUSD',
      from: 'treasury_wallet',
      to: 'offramp_wallet',
      amountMinor: payout.convert_minor,
    },
  ];
  const fee = Math.min(Math.max(0, networkFeeMinor), payout.fee_minor);
  if (fee > 0) {
    entries.push({
      currency: 'USD',
      from: 'fee_revenue',
      to: 'network_fee_expense',
      amountMinor: fee,
    });
  }
  postJournal(db, clock, log, payout.id, 'transfer final', entries);
}

export function onDepositSucceeded(
  db: Db,
  clock: Clock,
  log: FastifyBaseLogger,
  payout: PayoutAmounts,
  rateMoved = false,
): void {
  const entries: JournalLeg[] = [
    {
      currency: 'DUSD',
      from: 'offramp_wallet',
      to: 'offramp',
      amountMinor: payout.convert_minor,
    },
    {
      currency: 'MXN',
      from: 'offramp',
      to: 'recipient_bank',
      amountMinor: payout.receive_minor,
    },
  ];

  if (rateMoved) {
    // Platform absorbs ~2% worse conversion while recipient still gets receive_minor.
    const variance = Math.max(1, Math.floor(payout.receive_minor * 0.02));
    entries.push({
      currency: 'MXN',
      from: 'fx_variance',
      to: 'offramp',
      amountMinor: variance,
    });
  }

  postJournal(db, clock, log, payout.id, 'deposit succeeded', entries);
}

export function onDepositRejected(
  _db: Db,
  _clock: Clock,
  _log: FastifyBaseLogger,
  _payout: PayoutAmounts,
): void {
  // Money is still in offramp_wallet; the refund leg posts the reverse (PLAN §19).
}

export function onRefundSucceeded(
  db: Db,
  clock: Clock,
  log: FastifyBaseLogger,
  payout: PayoutAmounts,
): void {
  postJournal(db, clock, log, payout.id, 'refund succeeded', [
    {
      currency: 'DUSD',
      from: 'offramp_wallet',
      to: 'treasury_wallet',
      amountMinor: payout.convert_minor,
    },
    {
      currency: 'DUSD',
      from: 'treasury_wallet',
      to: 'onramp',
      amountMinor: payout.convert_minor,
    },
    {
      currency: 'USD',
      from: 'onramp',
      to: 'usd_clearing',
      amountMinor: payout.convert_minor,
    },
    {
      currency: 'USD',
      from: 'fee_revenue',
      to: 'usd_clearing',
      amountMinor: payout.fee_minor,
    },
    {
      currency: 'USD',
      from: 'usd_clearing',
      to: 'sender_bank',
      amountMinor: payout.send_minor,
    },
  ]);
}
