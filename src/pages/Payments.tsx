import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

import PageHeader from "@/components/PageHeader";
import StatusBadge from "@/components/StatusBadge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/externalClient";
import { getProfileDisplayName, type ProfileRecord, type PromotionRecord } from "@/lib/raffle";

interface Payment {
  amount: number;
  created_at: string;
  id: string;
  payment_date?: string | null;
  promotion_id?: string | null;
  status: string;
  user_id: string;
}

export default function Payments() {
  const [payments, setPayments] = useState<Payment[]>([]);
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

      setPayments((paymentsResponse.data || []) as Payment[]);
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
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Participante</TableHead>
                <TableHead>Poster</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Data</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell className="py-8 text-center text-muted-foreground" colSpan={5}>
                    Carregando...
                  </TableCell>
                </TableRow>
              ) : payments.length === 0 ? (
                <TableRow>
                  <TableCell className="py-8 text-center text-muted-foreground" colSpan={5}>
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
