import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarDays, Plus, Sparkles, Ticket, Trophy } from "lucide-react";
import { toast } from "sonner";

import LiveDrawDialog from "@/components/LiveDrawDialog";
import PageHeader from "@/components/PageHeader";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/externalClient";
import {
  buildQueueEntries,
  calculateDrawFinancials,
  DEFAULT_WINNER_COUNT,
  getProfileKey,
  getPromotionAmount,
  isPromotionActive,
  type DrawRecord,
  type PaymentRecord,
  type ProfileRecord,
  type PromotionRecord,
  type QueueEntry,
  pickUniqueQueuePositions,
} from "@/lib/raffle";

type DrawExecutionResult = {
  executedAt: string;
  platformCut: number;
  prizePerWinner: number;
  prizePool: number;
  totalPot: number;
  winnerPositions: number[];
  winners: QueueEntry[];
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    currency: "BRL",
    style: "currency",
  }).format(value);
}

function formatDrawMoment(value?: string | null) {
  if (!value) {
    return "A definir";
  }

  return format(new Date(value), "dd/MM/yyyy HH:mm", { locale: ptBR });
}

function getTable(table: string) {
  return (supabase as unknown as { from: (tableName: string) => any }).from(table);
}

export default function Draws() {
  const [draws, setDraws] = useState<DrawRecord[]>([]);
  const [promotions, setPromotions] = useState<PromotionRecord[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [profiles, setProfiles] = useState<ProfileRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [drawSceneOpen, setDrawSceneOpen] = useState(false);
  const [selectedPromotionId, setSelectedPromotionId] = useState("");
  const [selectedDrawId, setSelectedDrawId] = useState<string | null>(null);
  const [newDate, setNewDate] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionResult, setExecutionResult] = useState<DrawExecutionResult | null>(null);

  const loadData = async () => {
    if (!loading) {
      setLoading(true);
    }

    const [drawsResponse, promotionsResponse, paymentsResponse, profilesResponse] = await Promise.all([
      getTable("draws").select("*").order("draw_date", { ascending: false }),
      getTable("promotions").select("*").order("created_at", { ascending: false }),
      getTable("payments").select("*").order("created_at", { ascending: false }),
      getTable("profiles").select("*").order("created_at", { ascending: false }),
    ]);

    if (drawsResponse.error || promotionsResponse.error || paymentsResponse.error || profilesResponse.error) {
      toast.error("Nao foi possivel carregar o fluxo de sorteios agora.");
      setLoading(false);
      return;
    }

    setDraws((drawsResponse.data ?? []) as DrawRecord[]);
    setPromotions((promotionsResponse.data ?? []) as PromotionRecord[]);
    setPayments((paymentsResponse.data ?? []) as PaymentRecord[]);
    setProfiles((profilesResponse.data ?? []) as ProfileRecord[]);
    setLoading(false);
  };

  useEffect(() => {
    void loadData();
  }, []);

  const promotionById = useMemo(() => {
    return new Map(promotions.map((promotion) => [promotion.id, promotion]));
  }, [promotions]);

  const profilesByUserId = useMemo(() => {
    return new Map(
      profiles
        .map((profile) => [getProfileKey(profile), profile] as const)
        .filter(([key]) => Boolean(key)),
    );
  }, [profiles]);

  const queueByPromotionId = useMemo(() => {
    const map = new Map<string, QueueEntry[]>();

    for (const promotion of promotions) {
      const promotionPayments = payments.filter((payment) => payment.promotion_id === promotion.id);
      map.set(promotion.id, buildQueueEntries(promotionPayments, profilesByUserId));
    }

    return map;
  }, [payments, profilesByUserId, promotions]);

  const drawsByPromotionId = useMemo(() => {
    const map = new Map<string, DrawRecord[]>();

    for (const draw of draws) {
      if (!draw.promotion_id) {
        continue;
      }

      const current = map.get(draw.promotion_id) ?? [];
      current.push(draw);
      current.sort((left, right) => new Date(left.draw_date).getTime() - new Date(right.draw_date).getTime());
      map.set(draw.promotion_id, current);
    }

    return map;
  }, [draws]);

  const availablePromotions = useMemo(() => {
    return promotions.filter(isPromotionActive);
  }, [promotions]);

  const selectedDraw = selectedDrawId ? draws.find((draw) => draw.id === selectedDrawId) ?? null : null;
  const selectedPromotion = selectedDraw?.promotion_id
    ? promotionById.get(selectedDraw.promotion_id) ?? null
    : null;
  const selectedQueue = selectedPromotion ? queueByPromotionId.get(selectedPromotion.id) ?? [] : [];

  const openDrawScene = (drawId: string) => {
    setSelectedDrawId(drawId);
    setExecutionResult(null);
    setDrawSceneOpen(true);
  };

  const createDraw = async () => {
    if (!selectedPromotionId) {
      toast.error("Escolha a promocao que vai receber este sorteio.");
      return;
    }

    if (!newDate) {
      toast.error("Defina a data e hora do sorteio.");
      return;
    }

    const currentPromotionDraws = drawsByPromotionId.get(selectedPromotionId) ?? [];

    if (currentPromotionDraws.length >= 3) {
      toast.error("Esta promocao ja atingiu o limite de 3 sorteios.");
      return;
    }

    const payload = {
      draw_date: newDate,
      promotion_id: selectedPromotionId,
      sequence_number: currentPromotionDraws.length + 1,
      status: "scheduled",
      winner_count: DEFAULT_WINNER_COUNT,
    };

    const { error } = await getTable("draws").insert(payload);

    if (error) {
      toast.error(error.message || "Erro ao criar sorteio");
      return;
    }

    toast.success("Sorteio criado com sucesso.");
    setCreateDialogOpen(false);
    setSelectedPromotionId("");
    setNewDate("");
    await loadData();
  };

  const executeDraw = async () => {
    if (!selectedDraw?.promotion_id || !selectedPromotion) {
      toast.error("Selecione um sorteio vinculado a uma promocao.");
      return;
    }

    setIsExecuting(true);

    try {
      const [paymentsResponse, profilesResponse] = await Promise.all([
        getTable("payments")
          .select("*")
          .eq("promotion_id", selectedDraw.promotion_id)
          .order("payment_date", { ascending: true })
          .order("created_at", { ascending: true }),
        getTable("profiles").select("*"),
      ]);

      if (paymentsResponse.error || profilesResponse.error) {
        throw new Error("Nao foi possivel montar a fila oficial desta promocao.");
      }

      const liveProfiles = new Map(
        ((profilesResponse.data ?? []) as ProfileRecord[])
          .map((profile) => [getProfileKey(profile), profile] as const)
          .filter(([key]) => Boolean(key)),
      );

      const liveQueue = buildQueueEntries((paymentsResponse.data ?? []) as PaymentRecord[], liveProfiles);

      if (liveQueue.length < DEFAULT_WINNER_COUNT) {
        throw new Error("Sao necessarios pelo menos 3 pagamentos aprovados para executar o sorteio.");
      }

      const winnerPositions = pickUniqueQueuePositions(liveQueue.length, DEFAULT_WINNER_COUNT);
      const winners = winnerPositions
        .map((position) => liveQueue.find((entry) => entry.position === position) ?? null)
        .filter((entry): entry is QueueEntry => Boolean(entry));
      const executedAt = new Date().toISOString();
      const financials = calculateDrawFinancials(liveQueue, DEFAULT_WINNER_COUNT);

      const participantRows = liveQueue.map((entry) => ({
        created_at: executedAt,
        draw_id: selectedDraw.id,
        is_winner: winnerPositions.includes(entry.position),
        payment_id: entry.paymentId,
        position: entry.position,
        prize_amount: winnerPositions.includes(entry.position) ? financials.prizePerWinner : 0,
        user_id: entry.userId,
      }));

      const deleteResponse = await getTable("draw_participants").delete().eq("draw_id", selectedDraw.id);
      if (deleteResponse.error) {
        throw new Error("Nao foi possivel atualizar o snapshot da fila deste sorteio.");
      }

      const insertResponse = await getTable("draw_participants").insert(participantRows);
      if (insertResponse.error) {
        throw new Error("Nao foi possivel salvar a fila oficial deste sorteio.");
      }

      const updateResponse = await getTable("draws")
        .update({
          drawn_numbers: winnerPositions,
          executed_at: executedAt,
          platform_cut: financials.platformCut,
          prize_per_winner: financials.prizePerWinner,
          prize_pool: financials.prizePool,
          status: "drawn",
          total_pot: financials.totalPot,
          winner_count: DEFAULT_WINNER_COUNT,
          winner_user_ids: winners.map((winner) => winner.userId),
        })
        .eq("id", selectedDraw.id);

      if (updateResponse.error) {
        throw new Error(updateResponse.error.message || "Nao foi possivel persistir o resultado.");
      }

      setExecutionResult({
        executedAt,
        platformCut: financials.platformCut,
        prizePerWinner: financials.prizePerWinner,
        prizePool: financials.prizePool,
        totalPot: financials.totalPot,
        winnerPositions,
        winners,
      });

      toast.success("Resultado oficial salvo. A cena da live ja pode ser exibida.");
      await loadData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao executar o sorteio.");
      setExecutionResult(null);
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Sorteios"
        description="Crie sorteios por promocao, acompanhe a fila oficial e execute a cena da live com 3 vencedores."
        action={
          <Dialog
            onOpenChange={(open) => {
              setCreateDialogOpen(open);

              if (!open) {
                setSelectedPromotionId("");
                setNewDate("");
              }
            }}
            open={createDialogOpen}
          >
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Novo Sorteio
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Criar sorteio</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label>Promocao</Label>
                  <Select onValueChange={setSelectedPromotionId} value={selectedPromotionId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Escolha a promocao" />
                    </SelectTrigger>
                    <SelectContent>
                      {availablePromotions.length ? (
                        availablePromotions.map((promotion) => {
                          const drawCount = (drawsByPromotionId.get(promotion.id) ?? []).length;

                          return (
                            <SelectItem disabled={drawCount >= 3} key={promotion.id} value={promotion.id}>
                              {promotion.title} • {formatCurrency(getPromotionAmount(promotion))} • {drawCount}/3 sorteios
                            </SelectItem>
                          );
                        })
                      ) : (
                        <SelectItem disabled value="sem-promocoes">
                          Nenhuma promocao ativa
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Data e hora do sorteio</Label>
                  <Input
                    onChange={(event) => setNewDate(event.target.value)}
                    type="datetime-local"
                    value={newDate}
                  />
                </div>

                <p className="rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  A fila sera alimentada automaticamente pelos pagamentos aprovados da promocao escolhida. Cada promocao
                  aceita ate 3 sorteios.
                </p>

                <Button className="w-full" onClick={() => void createDraw()}>
                  Criar sorteio
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Promocao</TableHead>
                <TableHead>Agenda</TableHead>
                <TableHead>Fila</TableHead>
                <TableHead>Premio por ganhador</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Resultado</TableHead>
                <TableHead className="text-right">Acao</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell className="py-8 text-center text-muted-foreground" colSpan={7}>
                    Carregando sorteios...
                  </TableCell>
                </TableRow>
              ) : draws.length === 0 ? (
                <TableRow>
                  <TableCell className="py-8 text-center text-muted-foreground" colSpan={7}>
                    Nenhum sorteio cadastrado.
                  </TableCell>
                </TableRow>
              ) : (
                draws.map((draw) => {
                  const promotion = draw.promotion_id ? promotionById.get(draw.promotion_id) ?? null : null;
                  const queue = draw.promotion_id ? queueByPromotionId.get(draw.promotion_id) ?? [] : [];
                  const financials = calculateDrawFinancials(queue, DEFAULT_WINNER_COUNT);
                  const drawnNumbers = draw.drawn_numbers?.length ? draw.drawn_numbers.join(" • ") : "Aguardando";

                  return (
                    <TableRow key={draw.id}>
                      <TableCell>
                        <div className="space-y-1">
                          <p className="font-medium">{promotion?.title ?? "Promocao nao vinculada"}</p>
                          <p className="text-xs text-muted-foreground">
                            {draw.sequence_number ? `${draw.sequence_number}º sorteio da promocao` : "Rodada manual"}
                          </p>
                        </div>
                      </TableCell>

                      <TableCell>
                        <div className="space-y-1 text-sm">
                          <div className="flex items-center gap-2 text-foreground">
                            <CalendarDays className="h-4 w-4 text-primary" />
                            <span>{formatDrawMoment(draw.draw_date)}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Valor da promocao: {formatCurrency(getPromotionAmount(promotion))}
                          </p>
                        </div>
                      </TableCell>

                      <TableCell>
                        <div className="space-y-1 text-sm">
                          <div className="flex items-center gap-2 text-foreground">
                            <Ticket className="h-4 w-4 text-primary" />
                            <span>{queue.length} participante(s)</span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            3 numeros unicos sorteados dessa fila
                          </p>
                        </div>
                      </TableCell>

                      <TableCell>
                        <div className="space-y-1 text-sm">
                          <div className="flex items-center gap-2 text-foreground">
                            <Trophy className="h-4 w-4 text-accent" />
                            <span>{formatCurrency(draw.prize_per_winner ?? financials.prizePerWinner)}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Premio total: {formatCurrency(draw.prize_pool ?? financials.prizePool)}
                          </p>
                        </div>
                      </TableCell>

                      <TableCell>
                        <StatusBadge status={draw.status} />
                      </TableCell>

                      <TableCell>
                        <div className="space-y-1 text-sm">
                          <p className="font-medium">{drawnNumbers}</p>
                          <p className="text-xs text-muted-foreground">
                            {draw.executed_at ? `Executado em ${formatDrawMoment(draw.executed_at)}` : "Resultado ainda nao gerado"}
                          </p>
                        </div>
                      </TableCell>

                      <TableCell className="text-right">
                        {draw.status === "scheduled" ? (
                          <Button onClick={() => openDrawScene(draw.id)} size="sm" variant="outline">
                            <Sparkles className="mr-2 h-3 w-3" />
                            Abrir cena
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">Sorteio concluido</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <LiveDrawDialog
        draw={selectedDraw}
        isExecuting={isExecuting}
        onOpenChange={(open) => {
          setDrawSceneOpen(open);

          if (!open) {
            setSelectedDrawId(null);
            setExecutionResult(null);
          }
        }}
        onStart={() => void executeDraw()}
        open={drawSceneOpen}
        promotion={selectedPromotion}
        queue={selectedQueue}
        result={executionResult}
      />
    </>
  );
}
