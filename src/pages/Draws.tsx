import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Plus, Sparkles, Ticket, Trophy } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

import LiveDrawDialog, {
  type DrawExecutionInput,
  type DrawExecutionResult,
} from "@/components/LiveDrawDialog";
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
  buildTicketEntries,
  calculateDrawFinancials,
  deriveFederalWinningNumber,
  findClosestWinningTicket,
  formatTicketNumber,
  getDrawContestCode,
  getPaymentContestCode,
  getProfileKey,
  getPromotionContestCode,
  getPromotionNumberContestCode,
  isApprovedPayment,
  isPromotionActive,
  type DrawRecord,
  type PaymentRecord,
  type ProfileRecord,
  type PromotionNumberRecord,
  type PromotionRecord,
  type TicketEntry,
} from "@/lib/raffle";

const DEFAULT_RESULT_SOURCE = "manual";
const EXACT_RESULT_SOURCE = "manual_exact";
const CLOSEST_RESULT_SOURCE = "manual_closest";
const DEFAULT_WINNER_COUNT = 1;

function formatContestLabel(contestCode?: string | null) {
  const normalized = contestCode?.trim();
  return normalized ? `Concurso ${normalized}` : "Concurso sem identificador";
}

function summarizePromotionTitles(promotions: PromotionRecord[]) {
  const titles = promotions.map((promotion) => promotion.title.trim()).filter(Boolean);

  if (titles.length <= 2) {
    return titles.join(", ");
  }

  return `${titles.slice(0, 2).join(", ")} +${titles.length - 2}`;
}

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
  const [promotionNumbers, setPromotionNumbers] = useState<PromotionNumberRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [drawSceneOpen, setDrawSceneOpen] = useState(false);
  const [selectedContestCode, setSelectedContestCode] = useState("");
  const [selectedDrawId, setSelectedDrawId] = useState<string | null>(null);
  const [newDate, setNewDate] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);
  const [isResolvingClosestWinner, setIsResolvingClosestWinner] = useState(false);
  const [executionResult, setExecutionResult] = useState<DrawExecutionResult | null>(null);

  const loadData = async () => {
    if (!loading) {
      setLoading(true);
    }

    const [drawsResponse, promotionsResponse, paymentsResponse, profilesResponse, numbersResponse] = await Promise.all([
      getTable("draws").select("*").order("draw_date", { ascending: false }),
      getTable("promotions").select("*").order("created_at", { ascending: false }),
      getTable("payments").select("*").order("created_at", { ascending: false }),
      getTable("profiles").select("*").order("created_at", { ascending: false }),
      getTable("promotion_numbers").select("*").order("ticket_number", { ascending: true }),
    ]);

    if (
      drawsResponse.error ||
      promotionsResponse.error ||
      paymentsResponse.error ||
      profilesResponse.error ||
      numbersResponse.error
    ) {
      toast.error("Nao foi possivel carregar o fluxo de sorteios agora.");
      setLoading(false);
      return;
    }

    setDraws((drawsResponse.data ?? []) as DrawRecord[]);
    setPromotions((promotionsResponse.data ?? []) as PromotionRecord[]);
    setPayments((paymentsResponse.data ?? []) as PaymentRecord[]);
    setProfiles((profilesResponse.data ?? []) as ProfileRecord[]);
    setPromotionNumbers((numbersResponse.data ?? []) as PromotionNumberRecord[]);
    setLoading(false);
  };

  useEffect(() => {
    void loadData();
  }, []);

  const promotionById = useMemo(() => {
    return new Map(promotions.map((promotion) => [promotion.id, promotion]));
  }, [promotions]);

  const promotionsByContestCode = useMemo(() => {
    const map = new Map<string, PromotionRecord[]>();

    for (const promotion of promotions) {
      const contestCode = getPromotionContestCode(promotion);

      if (!contestCode) {
        continue;
      }

      const current = map.get(contestCode) ?? [];
      current.push(promotion);
      current.sort((left, right) => left.title.localeCompare(right.title));
      map.set(contestCode, current);
    }

    return map;
  }, [promotions]);

  const paymentsById = useMemo(() => {
    return new Map(payments.map((payment) => [payment.id, payment]));
  }, [payments]);

  const profilesByUserId = useMemo(() => {
    return new Map(
      profiles
        .map((profile) => [getProfileKey(profile), profile] as const)
        .filter(([key]) => Boolean(key)),
    );
  }, [profiles]);

  const paidPaymentsByContestCode = useMemo(() => {
    const map = new Map<string, PaymentRecord[]>();

    for (const payment of payments) {
      if (!isApprovedPayment(payment)) {
        continue;
      }

      const contestCode = getPaymentContestCode(payment, promotionById);

      if (!contestCode) {
        continue;
      }

      const current = map.get(contestCode) ?? [];
      current.push(payment);
      map.set(contestCode, current);
    }

    return map;
  }, [payments, promotionById]);

  const ticketsByContestCode = useMemo(() => {
    const groupedNumbers = new Map<string, PromotionNumberRecord[]>();

    for (const promotionNumber of promotionNumbers) {
      const contestCode = getPromotionNumberContestCode(promotionNumber, promotionById);

      if (!contestCode) {
        continue;
      }

      const current = groupedNumbers.get(contestCode) ?? [];
      current.push(promotionNumber);
      groupedNumbers.set(contestCode, current);
    }

    const map = new Map<string, TicketEntry[]>();

    for (const [contestCode, numbersForContest] of groupedNumbers.entries()) {
      map.set(contestCode, buildTicketEntries(numbersForContest, paymentsById, profilesByUserId));
    }

    return map;
  }, [paymentsById, profilesByUserId, promotionById, promotionNumbers]);

  const drawsByContestCode = useMemo(() => {
    const map = new Map<string, DrawRecord[]>();

    for (const draw of draws) {
      const contestCode = getDrawContestCode(draw);

      if (!contestCode) {
        continue;
      }

      const current = map.get(contestCode) ?? [];
      current.push(draw);
      current.sort((left, right) => new Date(left.draw_date).getTime() - new Date(right.draw_date).getTime());
      map.set(contestCode, current);
    }

    return map;
  }, [draws]);

  const availableContests = useMemo(() => {
    return Array.from(promotionsByContestCode.entries())
      .filter(([, contestPromotions]) => contestPromotions.some(isPromotionActive))
      .map(([contestCode, contestPromotions]) => ({
        contestCode,
        draws: drawsByContestCode.get(contestCode) ?? [],
        promotions: contestPromotions,
      }))
      .sort((left, right) => left.contestCode.localeCompare(right.contestCode, "pt-BR", { numeric: true }));
  }, [drawsByContestCode, promotionsByContestCode]);

  const selectedDraw = selectedDrawId ? draws.find((draw) => draw.id === selectedDrawId) ?? null : null;
  const selectedDrawContestCode = getDrawContestCode(selectedDraw);
  const selectedPromotions = selectedDrawContestCode ? promotionsByContestCode.get(selectedDrawContestCode) ?? [] : [];
  const selectedTickets = selectedDrawContestCode ? ticketsByContestCode.get(selectedDrawContestCode) ?? [] : [];

  const openDrawScene = (drawId: string) => {
    setSelectedDrawId(drawId);
    setExecutionResult(null);
    setDrawSceneOpen(true);
  };

  const createDraw = async () => {
    if (!selectedContestCode) {
      toast.error("Escolha o concurso que vai receber este sorteio.");
      return;
    }

    if (!newDate) {
      toast.error("Defina a data e hora do sorteio.");
      return;
    }

    const currentContestDraws = drawsByContestCode.get(selectedContestCode) ?? [];

    if (currentContestDraws.length) {
      toast.error("Este concurso ja possui um sorteio cadastrado.");
      return;
    }

    const payload = {
      contest_code: selectedContestCode,
      draw_date: newDate,
      promotion_id: null,
      result_source: DEFAULT_RESULT_SOURCE,
      sequence_number: 1,
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
    setSelectedContestCode("");
    setNewDate("");
    await loadData();
  };

  const loadLiveContestSnapshot = async (contestCode: string) => {
    const [paymentsResponse, profilesResponse, numbersResponse] = await Promise.all([
      getTable("payments")
        .select("*")
        .eq("contest_code", contestCode)
        .order("payment_date", { ascending: true })
        .order("created_at", { ascending: true }),
      getTable("profiles").select("*"),
      getTable("promotion_numbers")
        .select("*")
        .eq("contest_code", contestCode)
        .order("ticket_number", { ascending: true }),
    ]);

    if (paymentsResponse.error || profilesResponse.error || numbersResponse.error) {
      throw new Error("Nao foi possivel montar o pool oficial deste concurso.");
    }

    const livePayments = (paymentsResponse.data ?? []) as PaymentRecord[];
    const liveProfiles = new Map(
      ((profilesResponse.data ?? []) as ProfileRecord[])
        .map((profile) => [getProfileKey(profile), profile] as const)
        .filter(([key]) => Boolean(key)),
    );
    const livePaymentsById = new Map(livePayments.map((payment) => [payment.id, payment]));
    const livePaidPayments = livePayments.filter(isApprovedPayment);
    const liveTickets = buildTicketEntries(
      (numbersResponse.data ?? []) as PromotionNumberRecord[],
      livePaymentsById,
      liveProfiles,
    );

    if (!liveTickets.length) {
      throw new Error("Este concurso ainda nao possui numeros liberados para o sorteio.");
    }

    return {
      livePaidPayments,
      liveTickets,
    };
  };

  const executeDraw = async (input: DrawExecutionInput) => {
    if (!selectedDrawContestCode) {
      toast.error("Selecione um sorteio vinculado a um concurso.");
      return;
    }

    const officialWinningNumber = deriveFederalWinningNumber(input.firstPrizeNumber);

    if (officialWinningNumber === null) {
      toast.error("Informe o numero do 1o premio com pelo menos 4 digitos.");
      return;
    }

    setIsExecuting(true);

    try {
      const { livePaidPayments, liveTickets } = await loadLiveContestSnapshot(selectedDrawContestCode);

      const financials = calculateDrawFinancials(livePaidPayments, DEFAULT_WINNER_COUNT);
      const winningCode = formatTicketNumber(officialWinningNumber);
      const winnerTickets = liveTickets.filter((ticket) => ticket.ticketNumber === officialWinningNumber);
      const executedAt = new Date().toISOString();
      const winnerCodes = new Set(winnerTickets.map((ticket) => ticket.ticketCode));

      const participantRows = liveTickets.map((ticket, index) => {
        const isWinner = winnerCodes.has(ticket.ticketCode);

        return {
          created_at: executedAt,
          draw_id: selectedDraw.id,
          is_winner: isWinner,
          payment_id: ticket.paymentId,
          position: index + 1,
          prize_amount: isWinner ? financials.prizePerWinner : 0,
          ticket_number: ticket.ticketNumber,
          user_id: ticket.userId,
        };
      });

      const deleteResponse = await getTable("draw_participants").delete().eq("draw_id", selectedDraw.id);
      if (deleteResponse.error) {
        throw new Error("Nao foi possivel atualizar o snapshot dos numeros deste sorteio.");
      }

      const insertResponse = await getTable("draw_participants").insert(participantRows);
      if (insertResponse.error) {
        throw new Error("Nao foi possivel salvar os numeros oficiais deste sorteio.");
      }

      const updateResponse = await getTable("draws")
        .update({
          drawn_numbers: [officialWinningNumber],
          executed_at: executedAt,
          federal_contest: input.federalContest || null,
          federal_first_prize: input.firstPrizeNumber || null,
          official_winning_number: officialWinningNumber,
          platform_cut: financials.platformCut,
          prize_per_winner: financials.prizePerWinner,
          prize_pool: financials.prizePool,
          result_source: EXACT_RESULT_SOURCE,
          status: "drawn",
          total_pot: financials.totalPot,
          winner_count: winnerTickets.length,
          winner_user_ids: winnerTickets.map((ticket) => ticket.userId),
        })
        .eq("id", selectedDraw.id);

      if (updateResponse.error) {
        throw new Error(updateResponse.error.message || "Nao foi possivel persistir o resultado.");
      }

      setExecutionResult({
        executedAt,
        federalContest: input.federalContest || null,
        federalFirstPrize: input.firstPrizeNumber,
        officialWinningCode: winningCode,
        officialWinningNumber,
        platformCut: financials.platformCut,
        prizePerWinner: financials.prizePerWinner,
        prizePool: financials.prizePool,
        totalPot: financials.totalPot,
        winnerTickets,
        winnerSelectionMode: winnerTickets.length ? "exact" : "none",
      });

      toast.success(
        winnerTickets.length
          ? "Resultado oficial salvo com ganhador exato."
          : "Resultado oficial salvo sem ganhador exato. Use a busca do mais proximo se quiser continuar.",
      );
      await loadData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao executar o sorteio.");
      setExecutionResult(null);
    } finally {
      setIsExecuting(false);
    }
  };

  const resolveClosestWinner = async () => {
    if (!selectedDraw?.id || !selectedDrawContestCode || !executionResult) {
      toast.error("Abra uma cena com resultado oficial para localizar o ganhador mais proximo.");
      return;
    }

    if (executionResult.winnerTickets.length) {
      toast.success("Esta rodada ja possui ganhador exato.");
      return;
    }

    setIsResolvingClosestWinner(true);

    try {
      const { liveTickets } = await loadLiveContestSnapshot(selectedDrawContestCode);
      const closestWinnerTicket = findClosestWinningTicket(liveTickets, executionResult.officialWinningNumber);

      if (!closestWinnerTicket) {
        throw new Error("Nao foi possivel localizar um numero proximo no pool oficial.");
      }

      const winnerTickets = [closestWinnerTicket];
      const winnerCodes = new Set(winnerTickets.map((ticket) => ticket.ticketCode));
      const participantRows = liveTickets.map((ticket, index) => ({
        created_at: executionResult.executedAt,
        draw_id: selectedDraw.id,
        is_winner: winnerCodes.has(ticket.ticketCode),
        payment_id: ticket.paymentId,
        position: index + 1,
        prize_amount: winnerCodes.has(ticket.ticketCode) ? executionResult.prizePerWinner : 0,
        ticket_number: ticket.ticketNumber,
        user_id: ticket.userId,
      }));

      const deleteResponse = await getTable("draw_participants").delete().eq("draw_id", selectedDraw.id);
      if (deleteResponse.error) {
        throw new Error("Nao foi possivel atualizar o snapshot dos numeros deste sorteio.");
      }

      const insertResponse = await getTable("draw_participants").insert(participantRows);
      if (insertResponse.error) {
        throw new Error("Nao foi possivel salvar o ganhador mais proximo deste sorteio.");
      }

      const updateResponse = await getTable("draws")
        .update({
          result_source: CLOSEST_RESULT_SOURCE,
          winner_count: winnerTickets.length,
          winner_user_ids: winnerTickets.map((ticket) => ticket.userId),
        })
        .eq("id", selectedDraw.id);

      if (updateResponse.error) {
        throw new Error(updateResponse.error.message || "Nao foi possivel persistir o ganhador mais proximo.");
      }

      setExecutionResult((current) =>
        current
          ? {
              ...current,
              winnerTickets,
              winnerSelectionMode: "closest",
            }
          : current,
      );

      toast.success("Ganhador mais proximo encontrado e salvo.");
      await loadData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao localizar o ganhador mais proximo.");
    } finally {
      setIsResolvingClosestWinner(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Sorteios"
        description="Organize um sorteio por concurso e execute a live com base nos 4 ultimos digitos do 1o premio da Loteria Federal."
        action={
          <Dialog
            onOpenChange={(open) => {
              setCreateDialogOpen(open);

              if (!open) {
                setSelectedContestCode("");
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
                  <Label>Concurso</Label>
                  <Select onValueChange={setSelectedContestCode} value={selectedContestCode}>
                    <SelectTrigger>
                      <SelectValue placeholder="Escolha o concurso" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableContests.length ? (
                        availableContests.map(({ contestCode, draws: contestDraws, promotions: contestPromotions }) => {
                          const drawCount = contestDraws.length;

                          return (
                            <SelectItem disabled={drawCount > 0} key={contestCode} value={contestCode}>
                              {formatContestLabel(contestCode)} • {contestPromotions.length} promocao(oes) •{" "}
                              {drawCount ? "sorteio ja cadastrado" : "pronto para agendar"}
                            </SelectItem>
                          );
                        })
                      ) : (
                        <SelectItem disabled value="sem-concursos">
                          Nenhum concurso ativo
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  {selectedContestCode ? (
                    <p className="text-xs text-muted-foreground">
                      Promocoes neste concurso: {summarizePromotionTitles(promotionsByContestCode.get(selectedContestCode) ?? [])}
                    </p>
                  ) : null}
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
                  Todas as promocoes com o mesmo concurso compartilham este unico sorteio. A live usa os 4 ultimos
                  digitos do 1o premio da Loteria Federal para definir o numero vencedor.
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
                <TableHead>Concurso</TableHead>
                <TableHead>Agenda</TableHead>
                <TableHead>Numeros liberados</TableHead>
                <TableHead>Premio previsto</TableHead>
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
                  const contestCode = getDrawContestCode(draw);
                  const contestPromotions = contestCode ? promotionsByContestCode.get(contestCode) ?? [] : [];
                  const tickets = contestCode ? ticketsByContestCode.get(contestCode) ?? [] : [];
                  const paidPayments = contestCode ? paidPaymentsByContestCode.get(contestCode) ?? [] : [];
                  const financials = calculateDrawFinancials(paidPayments, DEFAULT_WINNER_COUNT);
                  const buyersCount = new Set(tickets.map((ticket) => ticket.userId)).size;
                  const officialResult =
                    typeof draw.official_winning_number === "number"
                      ? formatTicketNumber(draw.official_winning_number)
                      : "Aguardando";

                  return (
                    <TableRow key={draw.id}>
                      <TableCell>
                        <div className="space-y-1">
                          <p className="font-medium">{formatContestLabel(contestCode)}</p>
                          <p className="text-xs text-muted-foreground">
                            {contestPromotions.length
                              ? `${contestPromotions.length} promocao(oes): ${summarizePromotionTitles(contestPromotions)}`
                              : "Nenhuma promocao vinculada a este concurso"}
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
                            Sorteio unico compartilhado entre as promocoes do concurso
                          </p>
                        </div>
                      </TableCell>

                      <TableCell>
                        <div className="space-y-1 text-sm">
                          <div className="flex items-center gap-2 text-foreground">
                            <Ticket className="h-4 w-4 text-primary" />
                            <span>{tickets.length} numero(s)</span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {buyersCount} comprador(es) com numeros ativos neste concurso
                          </p>
                        </div>
                      </TableCell>

                      <TableCell>
                        <div className="space-y-1 text-sm">
                          <div className="flex items-center gap-2 text-foreground">
                            <Trophy className="h-4 w-4 text-accent" />
                            <span>{formatCurrency(draw.prize_pool ?? financials.prizePool)}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            80% do montante pago no concurso
                          </p>
                        </div>
                      </TableCell>

                      <TableCell>
                        <StatusBadge status={draw.status} />
                      </TableCell>

                      <TableCell>
                        <div className="space-y-1 text-sm">
                          <p className="font-medium">{officialResult}</p>
                          <p className="text-xs text-muted-foreground">
                            {draw.federal_contest
                              ? `Concurso ${draw.federal_contest}`
                              : draw.executed_at
                                ? "Resultado manual sem concurso informado"
                                : "Aguardando resultado oficial"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {draw.executed_at
                              ? `Executado em ${formatDrawMoment(draw.executed_at)}`
                              : "Live ainda nao consolidada"}
                          </p>
                        </div>
                      </TableCell>

                      <TableCell className="text-right">
                        <Button onClick={() => openDrawScene(draw.id)} size="sm" variant="outline">
                          <Sparkles className="mr-2 h-3 w-3" />
                          {draw.status === "drawn" ? "Ver resultado" : "Abrir cena"}
                        </Button>
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
        isResolvingClosestWinner={isResolvingClosestWinner}
        onOpenChange={(open) => {
          setDrawSceneOpen(open);

          if (!open) {
            setSelectedDrawId(null);
            setExecutionResult(null);
          }
        }}
        onStart={(input) => void executeDraw(input)}
        onResolveClosestWinner={() => resolveClosestWinner()}
        open={drawSceneOpen}
        contestCode={selectedDrawContestCode}
        promotions={selectedPromotions}
        result={executionResult}
        tickets={selectedTickets}
      />
    </>
  );
}
