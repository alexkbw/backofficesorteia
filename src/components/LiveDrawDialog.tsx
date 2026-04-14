import { useEffect, useMemo, useRef, useState } from "react";
import { Calendar, Hash, Loader2, Maximize2, Minimize2, Ticket, Trophy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  calculateDrawFinancials,
  DEFAULT_WINNER_COUNT,
  deriveFederalWinningNumber,
  formatTicketNumber,
  type DrawRecord,
  type PromotionRecord,
  type TicketEntry,
} from "@/lib/raffle";

export type DrawExecutionInput = {
  federalContest: string;
  firstPrizeNumber: string;
};

export type DrawExecutionResult = {
  executedAt: string;
  federalContest?: string | null;
  federalFirstPrize: string;
  officialWinningCode: string;
  officialWinningNumber: number;
  platformCut: number;
  prizePerWinner: number;
  prizePool: number;
  totalPot: number;
  winnerTickets: TicketEntry[];
  winnerSelectionMode: "closest" | "exact" | "none";
};

type FederalApiResponse = {
  dataApuracao?: string | null;
  dezenasSorteadasOrdemSorteio?: Array<string | number> | null;
  listaDezenas?: Array<string | number> | null;
  numero?: number | string | null;
};

type FederalLatestResult = {
  dataApuracao?: string | null;
  federalContest: string;
  firstPrizeNumber: string;
  officialWinningCode: string;
  sourceUrl: string;
};

const FEDERAL_API_URL = "https://servicebus2.caixa.gov.br/portaldeloterias/api/federal";

type LiveDrawDialogProps = {
  contestCode?: string | null;
  draw: DrawRecord | null;
  isExecuting: boolean;
  isResolvingClosestWinner: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: (input: DrawExecutionInput) => void;
  onResolveClosestWinner: () => Promise<void> | void;
  open: boolean;
  promotions: PromotionRecord[];
  result: DrawExecutionResult | null;
  tickets: TicketEntry[];
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    currency: "BRL",
    style: "currency",
  }).format(value);
}

function getRandomWinningCode() {
  const randomArray = new Uint32Array(1);
  crypto.getRandomValues(randomArray);
  return formatTicketNumber(randomArray[0] % 10000);
}

function formatContestLabel(contestCode?: string | null) {
  const normalized = contestCode?.trim();
  return normalized ? `Concurso ${normalized}` : "Concurso sem identificador";
}

function normalizeFederalContest(value?: number | string | null) {
  const normalized = `${value ?? ""}`.trim();
  return normalized || null;
}

function normalizeFirstPrizeNumber(payload: FederalApiResponse | null) {
  const candidate =
    payload?.dezenasSorteadasOrdemSorteio?.[0] ??
    payload?.listaDezenas?.[0] ??
    null;

  const normalized = `${candidate ?? ""}`.replace(/\D/g, "");
  return normalized || null;
}

function summarizePromotionTitles(promotions: PromotionRecord[]) {
  const titles = promotions.map((promotion) => promotion.title.trim()).filter(Boolean);

  if (titles.length <= 2) {
    return titles.join(", ");
  }

  return `${titles.slice(0, 2).join(", ")} +${titles.length - 2}`;
}

function formatWinnerAnnouncement(result: DrawExecutionResult | null) {
  if (!result) {
    return "Aguardando a confirmacao oficial da Loteria Federal.";
  }

  if (!result.winnerTickets.length) {
    return "Nao houve ganhador em cheio nesta rodada. Vamos revelar o numero participante mais proximo.";
  }

  if (result.winnerSelectionMode === "closest") {
    return `${result.winnerTickets[0].displayName} ficou com o numero ${result.winnerTickets[0].ticketCode}, o mais proximo do oficial ${result.officialWinningCode}.`;
  }

  return `${result.winnerTickets[0].displayName} ficou com o numero ${result.winnerTickets[0].ticketCode}.`;
}

export default function LiveDrawDialog({
  contestCode,
  draw,
  isExecuting,
  isResolvingClosestWinner,
  onOpenChange,
  onStart,
  onResolveClosestWinner,
  open,
  promotions,
  result,
  tickets,
}: LiveDrawDialogProps) {
  const dialogContentRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<"idle" | "countdown" | "rolling" | "revealed">("idle");
  const [revealMode, setRevealMode] = useState<"closest" | "official">("official");
  const [countdown, setCountdown] = useState(5);
  const [rollingCode, setRollingCode] = useState("0000");
  const [federalContestInput, setFederalContestInput] = useState("");
  const [federalResultError, setFederalResultError] = useState<string | null>(null);
  const [firstPrizeInput, setFirstPrizeInput] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLoadingFederalResult, setIsLoadingFederalResult] = useState(false);
  const [latestFederalResult, setLatestFederalResult] = useState<FederalLatestResult | null>(null);

  const previewFinancials = useMemo(() => calculateDrawFinancials(tickets, DEFAULT_WINNER_COUNT), [tickets]);
  const buyersCount = useMemo(() => new Set(tickets.map((ticket) => ticket.userId)).size, [tickets]);
  const promotionSummary = useMemo(() => summarizePromotionTitles(promotions), [promotions]);
  const winnerCodes = useMemo(
    () => new Set((result?.winnerTickets ?? []).map((ticket) => ticket.ticketCode)),
    [result?.winnerTickets],
  );

  useEffect(() => {
    if (!open) {
      setStage("idle");
      setRevealMode("official");
      setCountdown(5);
      setFederalResultError(null);
      setRollingCode("0000");
      return;
    }

    setFederalContestInput(draw?.federal_contest ?? "");
    setFirstPrizeInput(result?.federalFirstPrize ?? draw?.federal_first_prize ?? "");

    if (!result) {
      if (stage === "idle") {
        setCountdown(5);
        setRollingCode("0000");
      }
      return;
    }

    if (stage !== "idle") {
      return;
    }

    setRevealMode("official");
    setCountdown(5);
    setRollingCode("0000");
    setStage("countdown");
  }, [draw?.federal_contest, draw?.federal_first_prize, open, result, stage]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === dialogContentRef.current);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    handleFullscreenChange();

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    if (open) {
      return;
    }

    if (document.fullscreenElement === dialogContentRef.current) {
      void document.exitFullscreen().catch(() => undefined);
    }
  }, [open]);

  useEffect(() => {
    if (!open || stage !== "countdown") {
      return;
    }

    const timeout = window.setTimeout(() => {
      if (countdown <= 1) {
        setStage("rolling");
        return;
      }

      setCountdown((value) => value - 1);
    }, 1000);

    return () => window.clearTimeout(timeout);
  }, [countdown, open, stage]);

  useEffect(() => {
    if (!open || stage !== "rolling") {
      return;
    }

    const rollInterval = window.setInterval(() => {
      setRollingCode(getRandomWinningCode());
    }, 120);

    const finishTimeout = window.setTimeout(() => {
      void (async () => {
        if (revealMode === "closest") {
          await onResolveClosestWinner();
        }

        if (result) {
          setRollingCode(result.officialWinningCode);
        }

        setRevealMode("official");
        setStage("revealed");
      })();
    }, 4200);

    return () => {
      window.clearInterval(rollInterval);
      window.clearTimeout(finishTimeout);
    };
  }, [onResolveClosestWinner, open, result, revealMode, stage]);

  const financials = result ?? previewFinancials;
  const headline =
    stage === "idle"
      ? "Tudo pronto para a grande revelacao"
      : stage === "countdown"
        ? revealMode === "closest"
          ? "Agora vamos ao numero mais proximo"
          : "Contagem para revelar o numero da rodada"
        : stage === "rolling"
          ? revealMode === "closest"
            ? "Descobrindo o numero mais proximo"
            : "Revelando o numero vencedor"
          : result?.winnerTickets.length
            ? result.winnerSelectionMode === "closest"
              ? "Temos o numero mais proximo confirmado"
              : "Temos um ganhador!"
            : "Resultado oficial confirmado";
  const supportingText =
    stage === "idle"
      ? "Consulte o resultado oficial, confirme os dados e prepare a cena para revelar quem leva esta rodada."
      : stage === "countdown"
        ? revealMode === "closest"
          ? "Nao tivemos um numero em cheio. A contagem vai voltar para revelar o numero participante mais proximo."
          : "Tudo certo por aqui. Agora a live vai revelar o numero oficial desta rodada."
        : stage === "rolling"
          ? revealMode === "closest"
            ? "A cena esta procurando quem ficou mais perto do numero oficial."
            : "Os 4 ultimos digitos do primeiro premio estao sendo convertidos no numero da rodada."
          : result?.winnerTickets.length
            ? result.winnerSelectionMode === "closest"
              ? "Nao houve numero exato, mas ja temos o participante que ficou mais perto e levou a rodada."
              : "O numero oficial bateu em cheio e o ganhador ja esta confirmado."
            : "O numero oficial foi confirmado, mas ainda nao tivemos um numero em cheio.";
  const winnerAnnouncement = formatWinnerAnnouncement(result);

  const canStart =
    tickets.length > 0 &&
    !result &&
    !isExecuting &&
    firstPrizeInput.replace(/\D/g, "").length >= 4;
  const canResolveClosestWinner =
    Boolean(result) &&
    result?.winnerTickets.length === 0 &&
    !isExecuting &&
    !isResolvingClosestWinner;

  const hasFederalContestMismatch =
    Boolean(contestCode?.trim()) &&
    Boolean(latestFederalResult?.federalContest) &&
    contestCode?.trim() !== latestFederalResult?.federalContest?.trim();

  const handleStart = () => {
    onStart({
      federalContest: federalContestInput.trim(),
      firstPrizeNumber: firstPrizeInput.trim(),
    });
  };

  const handleToggleFullscreen = async () => {
    const dialogContent = dialogContentRef.current;

    if (!dialogContent) {
      return;
    }

    try {
      if (document.fullscreenElement === dialogContent) {
        await document.exitFullscreen();
        return;
      }

      await dialogContent.requestFullscreen();
    } catch {
      toast.error("Nao foi possivel entrar em tela cheia no navegador.");
    }
  };

  const handleResolveClosestWinner = () => {
    if (!result) {
      toast.error("Confirme o resultado oficial antes de buscar o ganhador mais proximo.");
      return;
    }

    if (result.winnerTickets.length) {
      toast.success("Esta rodada ja possui ganhador exato.");
      return;
    }

    if (deriveFederalWinningNumber(firstPrizeInput) === null) {
      toast.error("Informe o primeiro premio oficial com pelo 4 digitos.");
      return;
    }

    setRevealMode("closest");
    setCountdown(5);
    setRollingCode(result.officialWinningCode);
    setStage("countdown");
  };

  const handleLoadLatestFederalResult = async () => {
    setIsLoadingFederalResult(true);
    setFederalResultError(null);

    try {
      const response = await fetch(FEDERAL_API_URL, {
        cache: "no-store",
        headers: {
          Accept: "application/json",
        },
        method: "GET",
      });

      if (!response.ok) {
        throw new Error(`A Loteria respondeu ${response.status} ao consultar o resultado oficial.`);
      }

      const payload = (await response.json().catch(() => null)) as FederalApiResponse | null;
      const federalContest = normalizeFederalContest(payload?.numero);
      const firstPrizeNumber = normalizeFirstPrizeNumber(payload);

      if (!federalContest || !firstPrizeNumber) {
        throw new Error("A API da Loteria retornou um payload incompleto.");
      }

      const latestResult: FederalLatestResult = {
        dataApuracao: payload?.dataApuracao ?? null,
        federalContest,
        firstPrizeNumber,
        officialWinningCode: formatTicketNumber(Number.parseInt(firstPrizeNumber.slice(-4), 10)),
        sourceUrl: FEDERAL_API_URL,
      };

      setLatestFederalResult(latestResult);
      setFederalContestInput(federalContest);
      setFirstPrizeInput(firstPrizeNumber);
    } catch (error) {
      setFederalResultError(
        error instanceof Error
          ? `${error.message} Se a consulta no navegador falhar, confirme concurso e primeiro premio manualmente na cena.`
          : "Nao foi possivel consultar a API da loteria no backoffice. Confirme concurso e primeiro premio manualmente na cena.",
      );
    } finally {
      setIsLoadingFederalResult(false);
    }
  };

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && document.fullscreenElement === dialogContentRef.current) {
      void document.exitFullscreen().catch(() => undefined);
    }

    onOpenChange(nextOpen);
  };

  return (
    <Dialog onOpenChange={handleDialogOpenChange} open={open}>
      <DialogContent
        ref={dialogContentRef}
        className={cn(
          "overflow-y-auto overscroll-contain border-white/10 bg-slate-950 p-0 text-white [&>button:last-child]:right-4 [&>button:last-child]:top-4 [&>button:last-child]:rounded-full [&>button:last-child]:border [&>button:last-child]:border-white/15 [&>button:last-child]:bg-white/5 [&>button:last-child]:p-2 [&>button:last-child]:text-white/80 [&>button:last-child]:opacity-100 [&>button:last-child]:ring-0 [&>button:last-child]:hover:bg-white/10 [&>button:last-child]:hover:text-white [&>button:last-child]:focus:ring-0",
          isFullscreen
            ? "!left-0 !top-0 !h-screen !max-h-screen !w-screen !max-w-none !translate-x-0 !translate-y-0 !rounded-none border-0"
            : "max-h-[94vh] w-[min(96vw,72rem)] max-w-6xl",
        )}
      >
        <div className="relative">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,179,0,0.24),transparent_38%),radial-gradient(circle_at_bottom_left,rgba(56,189,248,0.14),transparent_32%),linear-gradient(180deg,#050913_0%,#090c1f_100%)]" />
          <Button
            aria-label={isFullscreen ? "Sair da tela cheia" : "Entrar em tela cheia"}
            className="absolute right-16 top-4 z-20 h-9 w-9 rounded-full border border-white/15 bg-white/5 p-0 text-white hover:bg-white/10"
            onClick={() => void handleToggleFullscreen()}
            size="icon"
            type="button"
            variant="ghost"
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
          <div className={cn("relative p-5 sm:p-6 lg:p-8", isFullscreen ? "min-h-screen" : "")}>
            <DialogHeader className="space-y-3 text-left">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.4em] text-amber-300/80">Modo live</p>
                    <DialogTitle className={cn("mt-2 text-3xl font-semibold", isFullscreen ? "xl:text-4xl" : "")}>
                      {headline}
                    </DialogTitle>
                    <p className="mt-2 max-w-3xl text-sm text-white/70">{supportingText}</p>
                  </div>
                  <div className="flex flex-wrap items-start justify-end gap-3">
                    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-right">
                      <p className="text-xs uppercase tracking-[0.3em] text-white/45">Concurso</p>
                      <p className="mt-2 max-w-[24rem] break-all text-lg font-semibold">{formatContestLabel(contestCode)}</p>
                      <p className="mt-2 text-xs text-white/55">
                        {promotions.length ? `${promotions.length} promocao(oes) nesta rodada` : "Rodada sem promocao vinculada"}
                      </p>
                    </div>
                  </div>
                </div>
              </DialogHeader>

            <div
              className={cn(
                "mt-6 grid gap-4",
                isFullscreen
                  ? "xl:min-h-[calc(100vh-13rem)] xl:grid-cols-[minmax(0,1.7fr)_minmax(360px,0.88fr)]"
                  : "lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.95fr)]",
              )}
            >
              <section
                className={cn(
                  "rounded-[2rem] border border-white/10 bg-white/[0.04] p-6 backdrop-blur",
                  isFullscreen ? "xl:flex xl:min-h-0 xl:flex-col" : "",
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.35em] text-white/45">Cena principal</p>
                    <h3 className={cn("mt-2 text-2xl font-semibold", isFullscreen ? "xl:text-3xl" : "")}>
                      {formatContestLabel(contestCode)}
                    </h3>
                    <p className="mt-2 text-sm text-white/55">
                      {promotionSummary || "Os itens desta rodada aparecem aqui para a transmissao."}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-amber-100">
                    <p className="text-xs uppercase tracking-[0.25em] text-amber-200/80">Numeros na rodada</p>
                    <p className="mt-1 text-2xl font-semibold">{tickets.length}</p>
                  </div>
                </div>

                <div
                  className={cn(
                    "mt-6 grid gap-4 md:grid-cols-[minmax(0,1.05fr)_minmax(260px,0.95fr)]",
                    isFullscreen ? "xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.82fr)]" : "",
                  )}
                >
                  <div
                    className={cn(
                      "rounded-[1.75rem] border border-white/10 bg-black/30 p-5",
                      isFullscreen ? "xl:flex xl:min-h-[52vh] xl:flex-col" : "",
                    )}
                  >
                    {stage === "countdown" ? (
                      <div className="flex flex-1 flex-col items-center justify-center py-6 text-center">
                        <div className="flex h-40 w-40 items-center justify-center rounded-full border border-amber-300/30 bg-amber-300/10 text-6xl font-semibold text-amber-200 shadow-[0_0_60px_rgba(245,158,11,0.18)]">
                          {countdown}
                        </div>
                        <p className="mt-5 text-sm uppercase tracking-[0.35em] text-white/45">
                          Revelacao em instantes
                        </p>
                      </div>
                    ) : (
                      <div
                        className={cn(
                          "space-y-4 text-center",
                          isFullscreen ? "xl:flex xl:flex-1 xl:flex-col xl:justify-center" : "",
                        )}
                      >
                        <p className="text-xs uppercase tracking-[0.3em] text-white/40">
                          Numero da rodada
                        </p>
                        <div
                          className={cn(
                            "rounded-[1.5rem] border border-white/10 bg-slate-900/70 px-4 py-10",
                            isFullscreen ? "xl:px-8 xl:py-16" : "",
                          )}
                        >
                          <p className={cn("text-7xl font-semibold tracking-[0.25em] text-amber-200", isFullscreen ? "xl:text-8xl" : "")}>
                            {stage === "revealed" && result ? result.officialWinningCode : rollingCode}
                          </p>
                        </div>
                        <p className="min-h-6 text-sm text-white/65">
                          {stage === "revealed" && result
                            ? result.winnerTickets.length
                              ? result.winnerSelectionMode === "closest"
                                ? `${result.winnerTickets[0].displayName} ficou com o numero ${result.winnerTickets[0].ticketCode}, o mais proximo do oficial ${result.officialWinningCode}.`
                                : `${result.winnerTickets[0].displayName} ficou com o numero ${result.winnerTickets[0].ticketCode}.`
                              : "Não houve ganhador em cheio,vamos para aquele que mais se aproximou."
                            : "Aguardando a confirmacao oficial da Loteria Federal."}
                        </p>
                        {stage === "revealed" && result ? (
                          result.winnerTickets.length ? (
                            <div
                              className={cn(
                                "rounded-[1.6rem] border px-5 py-5 text-left shadow-[0_0_45px_rgba(245,158,11,0.18)]",
                                result.winnerSelectionMode === "closest"
                                  ? "border-sky-300/30 bg-[linear-gradient(135deg,rgba(14,165,233,0.18),rgba(15,23,42,0.84))]"
                                  : "border-amber-300/35 bg-[linear-gradient(135deg,rgba(245,158,11,0.24),rgba(15,23,42,0.86))]",
                              )}
                            >
                              <div className="flex items-start gap-4">
                                <div
                                  className={cn(
                                    "flex h-14 w-14 items-center justify-center rounded-2xl border shadow-[0_0_24px_rgba(255,255,255,0.08)]",
                                    result.winnerSelectionMode === "closest"
                                      ? "border-sky-200/30 bg-sky-300/15 text-sky-100"
                                      : "border-amber-200/30 bg-amber-300/15 text-amber-100",
                                  )}
                                >
                                  <Trophy className="h-7 w-7" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs uppercase tracking-[0.32em] text-white/70">
                                    {result.winnerSelectionMode === "closest" ? "Numero mais proximo confirmado" : "Temos ganhador"}
                                  </p>
                                  <p className="mt-2 text-2xl font-semibold text-white">{result.winnerTickets[0].displayName}</p>
                                  <p className="mt-2 text-sm text-white/80">
                                    Numero premiado: <span className="font-semibold text-white">#{result.winnerTickets[0].ticketCode}</span>
                                  </p>
                                  <p className="mt-3 text-sm text-white/70">{winnerAnnouncement}</p>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="rounded-[1.6rem] border border-rose-300/25 bg-[linear-gradient(135deg,rgba(251,113,133,0.12),rgba(15,23,42,0.86))] px-5 py-5 text-left shadow-[0_0_35px_rgba(251,113,133,0.12)]">
                              <p className="text-xs uppercase tracking-[0.32em] text-rose-100/75">Sem ganhador em cheio</p>
                              <p className="mt-2 text-xl font-semibold text-white">Ninguem acertou exatamente o numero da rodada.</p>
                              <p className="mt-3 text-sm text-white/75">
                                Se quiser continuar a revelacao na live, use o botao ao lado para descobrir o numero participante mais proximo.
                              </p>
                            </div>
                          )
                        ) : null}
                      </div>
                    )}

                    {stage === "rolling" ? (
                      <div className="mt-6 space-y-2">
                        <div className="flex items-center justify-between text-xs uppercase tracking-[0.25em] text-white/45">
                          <span>Processando o resultado</span>
                          <span>Base oficial</span>
                        </div>
                        <Progress className="h-2 bg-white/10" value={78} />
                      </div>
                    ) : null}

                    {stage === "countdown" ? (
                      <div className="mt-6 space-y-2">
                        <div className="flex items-center justify-between text-xs uppercase tracking-[0.25em] text-white/45">
                          <span>Preparando a revelacao</span>
                          <span>{countdown}s</span>
                        </div>
                        <Progress className="h-2 bg-white/10" value={(6 - countdown) * 20} />
                      </div>
                    ) : null}
                  </div>

                  <div
                    className={cn(
                      "space-y-4 rounded-[1.75rem] border border-white/10 bg-black/30 p-5",
                      isFullscreen ? "xl:flex xl:min-h-[52vh] xl:flex-col" : "",
                    )}
                  >
                    <div className="space-y-2">
                      <Label className="text-xs uppercase tracking-[0.28em] text-white/55">Concurso oficial</Label>
                      <Input
                        disabled={Boolean(result) || isExecuting}
                        onChange={(event) => setFederalContestInput(event.target.value)}
                        placeholder="Ex.: 0598"
                        value={federalContestInput}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs uppercase tracking-[0.28em] text-white/55">Primeiro premio oficial</Label>
                      <Input
                        disabled={Boolean(result) || isExecuting}
                        onChange={(event) => setFirstPrizeInput(event.target.value)}
                        placeholder="Ex.: 48321"
                        value={firstPrizeInput}
                      />
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm text-white/70">
                      Use o botao abaixo para trazer o resultado oficial e preparar a cena. A confirmacao final continua sendo feita manualmente.
                    </div>

                    <Button
                      className="w-full border-white/15"
                      disabled={Boolean(result) || isExecuting || isLoadingFederalResult}
                      onClick={() => void handleLoadLatestFederalResult()}
                      size="sm"
                      variant="outline"
                    >
                      {isLoadingFederalResult ? <Loader2 className="animate-spin" /> : null}
                      {isLoadingFederalResult ? "Consultando Loteria..." : "Consultar API da Loteria"}
                    </Button>

                    {latestFederalResult ? (
                      <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm text-emerald-100/90">
                        <p className="font-medium">
                          Ultimo resultado encontrado: concurso {latestFederalResult.federalContest} • primeiro premio{" "}
                          {latestFederalResult.firstPrizeNumber}
                        </p>
                        <p className="mt-2 text-emerald-100/75">
                          Numero da rodada: {latestFederalResult.officialWinningCode}
                          {latestFederalResult.dataApuracao ? ` • apurado em ${latestFederalResult.dataApuracao}` : ""}
                        </p>
                      </div>
                    ) : null}

                    {hasFederalContestMismatch ? (
                      <div className="rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4 text-sm text-amber-100">
                        A API retornou o concurso {latestFederalResult?.federalContest}, mas esta live esta vinculada ao{" "}
                        {formatContestLabel(contestCode)}.
                      </div>
                    ) : null}

                    {federalResultError ? (
                      <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 p-4 text-sm text-rose-100">
                        {federalResultError}
                      </div>
                    ) : null}

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                        <p className="text-xs uppercase tracking-[0.3em] text-white/45">Pessoas participando</p>
                        <p className="mt-2 text-xl font-semibold">{buyersCount}</p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                        <p className="text-xs uppercase tracking-[0.3em] text-white/45">Promocoes na rodada</p>
                        <p className="mt-2 text-xl font-semibold">{promotions.length}</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className={cn("mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4", isFullscreen ? "xl:mt-auto" : "")}>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <p className="text-xs uppercase tracking-[0.3em] text-white/45">Arrecadacao da rodada</p>
                    <p className="mt-2 text-xl font-semibold">{formatCurrency(financials.totalPot)}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <p className="text-xs uppercase tracking-[0.3em] text-white/45">Premio da rodada</p>
                    <p className="mt-2 text-xl font-semibold">{formatCurrency(financials.prizePool)}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <p className="text-xs uppercase tracking-[0.3em] text-white/45">Pessoas confirmadas</p>
                    <p className="mt-2 text-xl font-semibold">{buyersCount}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <p className="text-xs uppercase tracking-[0.3em] text-white/45">Numero da sorte</p>
                    <p className="mt-2 text-xl font-semibold">
                      {result ? result.officialWinningCode : formatTicketNumber(0)}
                    </p>
                  </div>
                </div>
              </section>

              <section
                className={cn(
                  "rounded-[2rem] border border-white/10 bg-white/[0.04] p-6 backdrop-blur",
                  isFullscreen ? "xl:flex xl:min-h-0 xl:flex-col" : "",
                )}
              >
                <div className="mb-4 flex items-center gap-3">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-amber-200">
                    <Ticket className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold">Numeros participantes</h3>
                    <p className="text-sm text-white/55">
                      Todos os numeros confirmados que estao valendo nesta rodada.
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                    <div className="flex items-center gap-2 text-sm text-white/70">
                      <Calendar className="h-4 w-4 text-sky-300" />
                      <span>Dia da revelacao</span>
                    </div>
                    <p className="mt-3 text-lg font-semibold">
                      {draw?.draw_date
                        ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(draw.draw_date))
                        : "A definir"}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                    <div className="flex items-center gap-2 text-sm text-white/70">
                      <Hash className="h-4 w-4 text-amber-300" />
                      <span>Como o numero e definido</span>
                    </div>
                    <p className="mt-3 text-lg font-semibold">Usamos os 4 ultimos digitos do primeiro premio</p>
                  </div>
                </div>

                <ScrollArea
                  className={cn(
                    "mt-4 rounded-[1.5rem] border border-white/10 bg-black/25 p-2",
                    isFullscreen ? "h-[60vh] xl:h-[calc(100vh-24rem)] xl:min-h-[34rem]" : "h-[320px]",
                  )}
                >
                  <div className="space-y-2 p-2">
                    {tickets.length ? (
                      tickets.map((ticket) => {
                        const isWinner = winnerCodes.has(ticket.ticketCode);

                        return (
                          <div
                            className={`rounded-2xl border px-4 py-3 transition-colors ${
                              isWinner
                                ? "border-amber-300/40 bg-amber-300/10"
                                : "border-white/10 bg-white/[0.03]"
                            }`}
                            key={ticket.paymentId + ticket.ticketCode}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="font-medium">{ticket.displayName}</p>
                                <p className="hidden text-sm text-white/55">
                                  Dados internos ocultos na transmissao
                                </p>
                                <p className="text-sm text-white/55">{isWinner ? "Destaque da rodada" : "Participante confirmado"}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-xs uppercase tracking-[0.3em] text-white/40">
                                  {isWinner ? "Numero premiado" : "Numero"}
                                </p>
                                <p className="text-lg font-semibold">#{ticket.ticketCode}</p>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-white/55">
                        Ainda nao ha numeros liberados para este concurso.
                      </div>
                    )}
                  </div>
                </ScrollArea>

                <div className="mt-4 flex flex-wrap gap-3">
                  <Button className="flex-1" disabled={!canStart} onClick={handleStart} size="lg" variant="default">
                    {isExecuting ? <Loader2 className="animate-spin" /> : null}
                    {isExecuting ? "Salvando resultado..." : "Confirmar resultado oficial"}
                  </Button>
                  <Button
                    className="flex-1 bg-amber-400 text-slate-950 hover:bg-amber-300 disabled:bg-white/10 disabled:text-white/45"
                    disabled={!canResolveClosestWinner}
                    onClick={handleResolveClosestWinner}
                    size="lg"
                    type="button"
                  >
                    {isResolvingClosestWinner ? <Loader2 className="animate-spin" /> : null}
                    {isResolvingClosestWinner ? "Buscando mais proximo..." : "Buscar ganhador mais proximo"}
                  </Button>
                </div>

                {!tickets.length ? (
                  <p className="mt-3 text-xs text-amber-200/80">
                    Este sorteio precisa de pelo menos um numero liberado para o concurso.
                  </p>
                ) : null}

                {stage === "revealed" && result ? (
                  <div className="mt-4 rounded-[1.5rem] border border-emerald-400/20 bg-emerald-400/10 p-4">
                    <div className="flex items-center gap-2 text-emerald-200">
                      <Trophy className="h-4 w-4" />
                      <span className="text-sm font-medium">Resultado da rodada salvo</span>
                    </div>
                    <p className="mt-2 text-sm text-emerald-100/90">
                      {result.winnerTickets.length
                        ? result.winnerSelectionMode === "closest"
                          ? `O numero oficial ${result.officialWinningCode} foi confirmado e o participante mais proximo ja esta salvo.`
                          : `O numero ${result.officialWinningCode} foi confirmado e o ganhador desta rodada ja esta salvo.`
                        : `O numero ${result.officialWinningCode} foi confirmado, mas esta rodada terminou sem numero em cheio.`}
                    </p>
                  </div>
                ) : null}
              </section>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
