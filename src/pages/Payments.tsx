import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

import PageHeader from "@/components/PageHeader";
import StatusBadge from "@/components/StatusBadge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/externalClient";
import {
  getPaymentAttributionLabel,
  getPaymentAttributionSource,
  getProfileDisplayName,
  type PaymentRecord,
  type ProfileRecord,
  type PromotionRecord,
} from "@/lib/raffle";

function formatSourceLabel(value?: string | null) {
  const normalized = value?.trim().toLowerCase();

  switch (normalized) {
    case "facebook":
      return "Facebook";
    case "google":
      return "Google";
    case "instagram":
      return "Instagram";
    case "kwai":
      return "Kwai";
    case "meta":
      return "Meta";
    case "tiktok":
      return "TikTok";
    case "x":
      return "X";
    case "youtube":
      return "YouTube";
    default:
      return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : "Nao atribuido";
  }
}

export default function Payments() {
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [profiles, setProfiles] = useState<ProfileRecord[]>([]);
  const [promotions, setPromotions] = useState<PromotionRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [paymentsResponse, profilesResponse, promotionsResponse] = await Promise.all([
        supabase.from("payments").select("*").order("created_at", { ascending: false }),
        supabase.from("profiles").select("*"),
        supabase.from("promotions").select("*"),
      ]);

      setPayments((paymentsResponse.data || []) as PaymentRecord[]);
      setProfiles((profilesResponse.data || []) as ProfileRecord[]);
      setPromotions((promotionsResponse.data || []) as PromotionRecord[]);
      setLoading(false);
    }

    void load();
  }, []);

  const profilesByUserId = useMemo(() => {
    return new Map(profiles.map((profile) => [profile.user_id ?? profile.id ?? "", profile]));
  }, [profiles]);

  const promotionById = useMemo(() => {
    return new Map(promotions.map((promotion) => [promotion.id, promotion]));
  }, [promotions]);

  return (
    <>
      <PageHeader
        title="Pagamentos"
        description="Historico das compras de poster que liberam PDF e numeros promocionais"
      />
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Participante</TableHead>
                <TableHead>Poster</TableHead>
                <TableHead>Qtd.</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Campanha</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Data</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell className="py-8 text-center text-muted-foreground" colSpan={8}>
                    Carregando...
                  </TableCell>
                </TableRow>
              ) : payments.length === 0 ? (
                <TableRow>
                  <TableCell className="py-8 text-center text-muted-foreground" colSpan={8}>
                    Nenhum pagamento
                  </TableCell>
                </TableRow>
              ) : (
                payments.map((payment) => {
                  const profile = profilesByUserId.get(payment.user_id);
                  const promotion = payment.promotion_id ? promotionById.get(payment.promotion_id) ?? null : null;

                  return (
                    <TableRow key={payment.id}>
                      <TableCell className="font-medium">
                        {getProfileDisplayName(profile, payment.user_id)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {promotion?.title ?? "Promocao nao vinculada"}
                      </TableCell>
                      <TableCell>{payment.poster_quantity ?? 1}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatSourceLabel(getPaymentAttributionSource(payment))}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {getPaymentAttributionLabel(payment)}
                      </TableCell>
                      <TableCell>R$ {Number(payment.amount).toFixed(2)}</TableCell>
                      <TableCell>
                        <StatusBadge status={payment.status} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {format(new Date(payment.payment_date ?? payment.created_at), "dd/MM/yyyy HH:mm", {
                          locale: ptBR,
                        })}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
