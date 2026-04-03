export type PromotionRecord = {
  active?: boolean | null;
  created_at?: string | null;
  description?: string | null;
  entry_amount?: number | null;
  id: string;
  image_url?: string | null;
  is_active?: boolean | null;
  title: string;
};

export type DrawRecord = {
  created_at?: string | null;
  draw_date: string;
  drawn_numbers?: number[] | null;
  executed_at?: string | null;
  id: string;
  platform_cut?: number | null;
  prize_per_winner?: number | null;
  prize_pool?: number | null;
  promotion_id?: string | null;
  sequence_number?: number | null;
  status: string;
  total_pot?: number | null;
  winner_count?: number | null;
  winner_user_ids?: string[] | null;
};

export type PaymentRecord = {
  amount?: number | null;
  created_at?: string | null;
  draw_id?: string | null;
  id: string;
  payment_date?: string | null;
  promotion_id?: string | null;
  status?: string | null;
  transaction_id?: string | null;
  user_id: string;
};

export type ProfileRecord = {
  avatar_url?: string | null;
  birth_date?: string | null;
  chat_bubble_theme?: string | null;
  cpf?: string | null;
  created_at?: string | null;
  display_name?: string | null;
  email?: string | null;
  full_name?: string | null;
  id?: string | null;
  updated_at?: string | null;
  user_id?: string | null;
};

export type QueueEntry = {
  amount: number;
  approvedAt: string;
  cpf?: string | null;
  displayName: string;
  email?: string | null;
  paymentId: string;
  position: number;
  userId: string;
};

export const DEFAULT_PROMOTION_AMOUNT = 10;
export const PLATFORM_PERCENTAGE = 0.2;
export const DEFAULT_WINNER_COUNT = 3;

export function normalizePaymentStatus(status?: string | null) {
  switch ((status ?? "").toLowerCase()) {
    case "approved":
    case "completed":
    case "paid":
      return "paid";
    case "cancelled":
    case "charged_back":
    case "failed":
    case "refunded":
    case "rejected":
      return "failed";
    default:
      return "pending";
  }
}

export function isApprovedPayment(payment: PaymentRecord) {
  return normalizePaymentStatus(payment.status) === "paid";
}

export function isPromotionActive(promotion: PromotionRecord) {
  if (typeof promotion.is_active === "boolean") {
    return promotion.is_active;
  }

  if (typeof promotion.active === "boolean") {
    return promotion.active;
  }

  return true;
}

export function getPromotionAmount(promotion?: PromotionRecord | null) {
  const value = Number(promotion?.entry_amount ?? DEFAULT_PROMOTION_AMOUNT);
  return Number.isFinite(value) && value > 0 ? Number(value.toFixed(2)) : DEFAULT_PROMOTION_AMOUNT;
}

export function getProfileKey(profile: ProfileRecord) {
  return profile.user_id ?? profile.id ?? "";
}

export function getProfileDisplayName(profile?: ProfileRecord | null, userId?: string) {
  const label =
    profile?.full_name ||
    profile?.display_name ||
    profile?.email ||
    userId;

  return label ? label : "Participante";
}

export function buildQueueEntries(
  payments: PaymentRecord[],
  profilesByUserId: Map<string, ProfileRecord>,
) {
  const seenUsers = new Set<string>();

  return payments
    .filter(isApprovedPayment)
    .sort((left, right) => {
      const leftMoment = new Date(left.payment_date ?? left.created_at ?? 0).getTime();
      const rightMoment = new Date(right.payment_date ?? right.created_at ?? 0).getTime();

      if (leftMoment === rightMoment) {
        return left.id.localeCompare(right.id);
      }

      return leftMoment - rightMoment;
    })
    .flatMap((payment) => {
      if (seenUsers.has(payment.user_id)) {
        return [];
      }

      seenUsers.add(payment.user_id);
      const profile = profilesByUserId.get(payment.user_id);

      return [
        {
          amount: Number(payment.amount ?? 0),
          approvedAt: payment.payment_date ?? payment.created_at ?? new Date().toISOString(),
          cpf: profile?.cpf ?? null,
          displayName: getProfileDisplayName(profile, payment.user_id),
          email: profile?.email ?? null,
          paymentId: payment.id,
          position: seenUsers.size,
          userId: payment.user_id,
        } satisfies QueueEntry,
      ];
    });
}

export function roundCurrency(value: number) {
  return Number(value.toFixed(2));
}

export function calculateDrawFinancials(queue: QueueEntry[], winnerCount = DEFAULT_WINNER_COUNT) {
  const totalPot = roundCurrency(queue.reduce((sum, entry) => sum + Number(entry.amount || 0), 0));
  const platformCut = roundCurrency(totalPot * PLATFORM_PERCENTAGE);
  const prizePool = roundCurrency(totalPot - platformCut);
  const prizePerWinner = winnerCount > 0 ? roundCurrency(prizePool / winnerCount) : 0;

  return {
    platformCut,
    prizePerWinner,
    prizePool,
    totalPot,
  };
}

export function pickUniqueQueuePositions(queueLength: number, winnerCount = DEFAULT_WINNER_COUNT) {
  const pool = Array.from({ length: queueLength }, (_, index) => index + 1);

  for (let index = pool.length - 1; index > 0; index -= 1) {
    const randomArray = new Uint32Array(1);
    crypto.getRandomValues(randomArray);
    const randomIndex = randomArray[0] % (index + 1);
    const current = pool[index];
    pool[index] = pool[randomIndex];
    pool[randomIndex] = current;
  }

  return pool.slice(0, winnerCount);
}
