export type PromotionRecord = {
  active?: boolean | null;
  contest_code?: string | null;
  created_at?: string | null;
  description?: string | null;
  entry_amount?: number | null;
  file_type?: string | null;
  file_url?: string | null;
  id: string;
  image_url?: string | null;
  is_active?: boolean | null;
  number_package_size?: number | null;
  title: string;
};

export type DrawRecord = {
  contest_code?: string | null;
  created_at?: string | null;
  draw_date: string;
  drawn_numbers?: number[] | null;
  executed_at?: string | null;
  federal_contest?: string | null;
  federal_first_prize?: string | null;
  id: string;
  official_winning_number?: number | null;
  platform_cut?: number | null;
  prize_per_winner?: number | null;
  prize_pool?: number | null;
  promotion_id?: string | null;
  result_source?: string | null;
  sequence_number?: number | null;
  status: string;
  total_pot?: number | null;
  winner_count?: number | null;
  winner_user_ids?: string[] | null;
};

export type PaymentRecord = {
  amount?: number | null;
  attribution_campaign?: string | null;
  attribution_content?: string | null;
  attribution_id?: string | null;
  attribution_landing_path?: string | null;
  attribution_medium?: string | null;
  attribution_referrer_host?: string | null;
  attribution_source?: string | null;
  attributed_at?: string | null;
  contest_code?: string | null;
  created_at?: string | null;
  draw_id?: string | null;
  id: string;
  payment_date?: string | null;
  poster_quantity?: number | null;
  promotion_id?: string | null;
  status?: string | null;
  transaction_id?: string | null;
  user_id: string;
};

export type PromotionNumberRecord = {
  contest_code?: string | null;
  created_at?: string | null;
  id: string;
  payment_id: string;
  promotion_id: string;
  ticket_number: number;
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

export type TicketEntry = {
  amount: number;
  approvedAt: string;
  cpf?: string | null;
  displayName: string;
  email?: string | null;
  paymentId: string;
  ticketCode: string;
  ticketNumber: number;
  userId: string;
};

export const DEFAULT_PROMOTION_AMOUNT = 10;
export const DEFAULT_PROMOTION_PACKAGE_SIZE = 10;
export const MAX_PROMOTION_PACKAGE_SIZE = 9999;
export const DEFAULT_WINNER_COUNT = 1;
export const PLATFORM_PERCENTAGE = 0.2;

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

function normalizeAttributionValue(value?: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function getPaymentAttributionSource(payment?: PaymentRecord | null) {
  return normalizeAttributionValue(payment?.attribution_source);
}

export function getPaymentAttributionCampaign(payment?: PaymentRecord | null) {
  return normalizeAttributionValue(payment?.attribution_campaign);
}

export function getPaymentAttributionId(payment?: PaymentRecord | null) {
  return normalizeAttributionValue(payment?.attribution_id);
}

export function hasPaymentAttribution(payment?: PaymentRecord | null) {
  return Boolean(
    getPaymentAttributionSource(payment) ||
      normalizeAttributionValue(payment?.attribution_medium) ||
      getPaymentAttributionCampaign(payment) ||
      getPaymentAttributionId(payment) ||
      normalizeAttributionValue(payment?.attribution_content),
  );
}

export function getPaymentAttributionLabel(payment?: PaymentRecord | null) {
  return getPaymentAttributionCampaign(payment) || getPaymentAttributionId(payment) || "Campanha nao identificada";
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

export function normalizePackageSize(value?: number | null) {
  const normalized = Number(value ?? DEFAULT_PROMOTION_PACKAGE_SIZE);

  if (!Number.isInteger(normalized) || normalized < 1) {
    return DEFAULT_PROMOTION_PACKAGE_SIZE;
  }

  return Math.min(normalized, MAX_PROMOTION_PACKAGE_SIZE);
}

export function normalizeContestCode(value?: string | null, fallback?: string | null) {
  const normalized = value?.trim();

  if (normalized) {
    return normalized;
  }

  const normalizedFallback = fallback?.trim();
  return normalizedFallback || "";
}

export function getPromotionContestCode(promotion?: PromotionRecord | null) {
  return normalizeContestCode(promotion?.contest_code, promotion?.id);
}

export function getDrawContestCode(draw?: DrawRecord | null) {
  return normalizeContestCode(draw?.contest_code, draw?.promotion_id ?? draw?.id);
}

export function getPaymentContestCode(
  payment: PaymentRecord,
  promotionsById?: Map<string, PromotionRecord>,
) {
  const promotion = payment.promotion_id ? promotionsById?.get(payment.promotion_id) ?? null : null;
  return normalizeContestCode(payment.contest_code, getPromotionContestCode(promotion) || payment.promotion_id || payment.id);
}

export function getPromotionNumberContestCode(
  promotionNumber: PromotionNumberRecord,
  promotionsById?: Map<string, PromotionRecord>,
) {
  const promotion = promotionsById?.get(promotionNumber.promotion_id) ?? null;
  return normalizeContestCode(
    promotionNumber.contest_code,
    getPromotionContestCode(promotion) || promotionNumber.promotion_id || promotionNumber.id,
  );
}

export function formatTicketNumber(value?: number | null) {
  const normalized = Number(value ?? 0);

  if (!Number.isFinite(normalized) || normalized < 0) {
    return "0000";
  }

  return String(Math.trunc(normalized)).padStart(4, "0");
}

export function deriveFederalWinningNumber(firstPrizeValue?: string | null) {
  const normalized = (firstPrizeValue ?? "").replace(/\D/g, "");

  if (normalized.length < 4) {
    return null;
  }

  return Number.parseInt(normalized.slice(-4), 10);
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

export function buildTicketEntries(
  promotionNumbers: PromotionNumberRecord[],
  paymentsById: Map<string, PaymentRecord>,
  profilesByUserId: Map<string, ProfileRecord>,
) {
  return promotionNumbers
    .filter((promotionNumber) => {
      const payment = paymentsById.get(promotionNumber.payment_id);
      return Boolean(payment && isApprovedPayment(payment));
    })
    .sort((left, right) => {
      if (left.ticket_number === right.ticket_number) {
        return left.id.localeCompare(right.id);
      }

      return left.ticket_number - right.ticket_number;
    })
    .map((promotionNumber) => {
      const payment = paymentsById.get(promotionNumber.payment_id);
      const profile = profilesByUserId.get(promotionNumber.user_id);

      return {
        amount: Number(payment?.amount ?? 0),
        approvedAt: payment?.payment_date ?? payment?.created_at ?? promotionNumber.created_at ?? new Date().toISOString(),
        cpf: profile?.cpf ?? null,
        displayName: getProfileDisplayName(profile, promotionNumber.user_id),
        email: profile?.email ?? null,
        paymentId: promotionNumber.payment_id,
        ticketCode: formatTicketNumber(promotionNumber.ticket_number),
        ticketNumber: promotionNumber.ticket_number,
        userId: promotionNumber.user_id,
      } satisfies TicketEntry;
    });
}

export function findClosestWinningTicket(tickets: TicketEntry[], officialWinningNumber: number) {
  if (!tickets.length) {
    return null;
  }

  let closestTicket = tickets[0];
  let closestDistance = Math.abs(closestTicket.ticketNumber - officialWinningNumber);

  for (const ticket of tickets.slice(1)) {
    const distance = Math.abs(ticket.ticketNumber - officialWinningNumber);

    if (distance < closestDistance) {
      closestTicket = ticket;
      closestDistance = distance;
      continue;
    }

    if (distance !== closestDistance) {
      continue;
    }

    const ticketIsAbove = ticket.ticketNumber >= officialWinningNumber;
    const closestIsAbove = closestTicket.ticketNumber >= officialWinningNumber;

    if (ticketIsAbove && !closestIsAbove) {
      closestTicket = ticket;
      continue;
    }

    if (ticketIsAbove === closestIsAbove && ticket.ticketNumber > closestTicket.ticketNumber) {
      closestTicket = ticket;
    }
  }

  return closestTicket;
}

export function roundCurrency(value: number) {
  return Number(value.toFixed(2));
}

export function calculateDrawFinancials(
  entries: Array<{ amount?: number | null }>,
  winnerCount = DEFAULT_WINNER_COUNT,
) {
  const totalPot = roundCurrency(entries.reduce((sum, entry) => sum + Number(entry.amount ?? 0), 0));
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
