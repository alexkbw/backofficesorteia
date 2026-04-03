import { useEffect, useMemo, useState } from "react";
import { Calendar, Loader2, Sparkles, Ticket, Trophy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  calculateDrawFinancials,
  type DrawRecord,
  type PromotionRecord,
  type QueueEntry,
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

type LiveDrawDialogProps = {
  draw: DrawRecord | null;
  isExecuting: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: () => void;
  open: boolean;
  promotion: PromotionRecord | null;
  queue: QueueEntry[];
  result: DrawExecutionResult | null;
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    currency: "BRL",
    style: "currency",
  }).format(value);
}

function getRandomNumber(max: number) {
  const randomArray = new Uint32Array(1);
  crypto.getRandomValues(randomArray);
  return max > 0 ? (randomArray[0] % max) + 1 : 0;
}

export default function LiveDrawDialog({
  draw,
  isExecuting,
  onOpenChange,
  onStart,
  open,
  promotion,
  queue,
  result,
}: LiveDrawDialogProps) {
  const [stage, setStage] = useState<"idle" | "countdown" | "rolling" | "revealed">("idle");
  const [countdown, setCountdown] = useState(5);
  const [rollingNumbers, setRollingNumbers] = useState([0, 0, 0]);

  const previewFinancials = useMemo(() => {
    return calculateDrawFinancials(queue);
  }, [queue]);

  useEffect(() => {
    if (!open) {
      setStage("idle");
      setCountdown(5);
      setRollingNumbers([0, 0, 0]);
      return;
    }

    if (result) {
      setStage("countdown");
      setCountdown(5);
      setRollingNumbers([0, 0, 0]);
      return;
    }

    setStage("idle");
    setCountdown(5);
    setRollingNumbers([0, 0, 0]);
  }, [open, result]);

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
      setRollingNumbers([
        getRandomNumber(queue.length),
        getRandomNumber(queue.length),
        getRandomNumber(queue.length),
      ]);
    }, 120);

    const finishTimeout = window.setTimeout(() => {
      if (result) {
        setRollingNumbers(result.winnerPositions);
      }

      setStage("revealed");
    }, 4200);

    return () => {
      window.clearInterval(rollInterval);
      window.clearTimeout(finishTimeout);
    };
  }, [open, queue.length, result, stage]);

  const financials = result ?? previewFinancials;
  const headline =
    stage === "idle"
      ? "Fila pronta para a live"
      : stage === "countdown"
        ? "Contagem regressiva oficial"
        : stage === "rolling"
          ? "Gerando os numeros vencedores"
          : "Resultado confirmado";

  const supportingText =
    stage === "idle"
      ? "Confira a fila antes de iniciar a cena do sorteio."
      : stage === "countdown"
        ? "A cena ja esta travada com os numeros oficiais. Agora e so criar suspense."
        : stage === "rolling"
          ? "Os 3 numeros unicos estao sendo embaralhados para revelacao."
          : "Os ganhadores ja foram gravados no banco com horario, numeros e premiacao.";

  const canStart = queue.length >= 3 && !result && !isExecuting;

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-hidden border-white/10 bg-slate-950 p-0 text-white">
        <div className="relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,179,0,0.24),transparent_38%),radial-gradient(circle_at_bottom_left,rgba(56,189,248,0.14),transparent_32%),linear-gradient(180deg,#050913_0%,#090c1f_100%)]" />
          <div className="relative p-6 sm:p-8">
            <DialogHeader className="space-y-3 text-left">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.4em] text-amber-300/80">Modo live</p>
                  <DialogTitle className="mt-2 text-3xl font-semibold">{headline}</DialogTitle>
                  <p className="mt-2 max-w-3xl text-sm text-white/70">{supportingText}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-right">
                  <p className="text-xs uppercase tracking-[0.3em] text-white/45">Promocao</p>
                  <p className="mt-2 text-lg font-semibold">{promotion?.title ?? "Promocao vinculada"}</p>
                </div>
              </div>
            </DialogHeader>

            <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.95fr)]">
              <section className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-6 backdrop-blur">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.35em] text-white/45">Cena principal</p>
                    <h3 className="mt-2 text-2xl font-semibold">
                      {promotion?.title ?? "Sorteio"} {draw?.sequence_number ? `• ${draw.sequence_number}º rodada` : ""}
                    </h3>
                  </div>

                  <div className="rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-amber-100">
                    <p className="text-xs uppercase tracking-[0.25em] text-amber-200/80">Fila atual</p>
                    <p className="mt-1 text-2xl font-semibold">{queue.length}</p>
                  </div>
                </div>

                <div className="mt-6 rounded-[1.75rem] border border-white/10 bg-black/30 p-5">
                  {stage === "countdown" ? (
                    <div className="flex flex-col items-center justify-center py-6 text-center">
                      <div className="flex h-40 w-40 items-center justify-center rounded-full border border-amber-300/30 bg-amber-300/10 text-6xl font-semibold text-amber-200 shadow-[0_0_60px_rgba(245,158,11,0.18)]">
                        {countdown}
                      </div>
                      <p className="mt-5 text-sm uppercase tracking-[0.35em] text-white/45">
                        A live comeca em instantes
                      </p>
                    </div>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-3">
                      {(stage === "revealed" && result ? result.winnerPositions : rollingNumbers).map((number, index) => {
                        const winner = stage === "revealed" ? result?.winners[index] ?? null : null;

                        return (
                          <div
                            className="rounded-[1.5rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.10),rgba(255,255,255,0.03))] p-4 text-center shadow-[0_0_40px_rgba(15,23,42,0.36)]"
                            key={`${index}-${number}`}
                          >
                            <p className="text-xs uppercase tracking-[0.3em] text-white/40">Numero {index + 1}</p>
                            <div className="mt-4 rounded-[1.25rem] border border-white/10 bg-slate-900/70 px-4 py-8">
                              <p className="text-6xl font-semibold text-amber-200">{number || "?"}</p>
                            </div>
                            <p className="mt-4 text-xs uppercase tracking-[0.3em] text-white/40">Posicao da fila</p>
                            <p className="mt-2 min-h-10 text-sm text-white/70">
                              {winner ? `${winner.displayName} • ${winner.cpf ?? "CPF nao informado"}` : "Aguardando revelacao"}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {stage === "rolling" ? (
                    <div className="mt-6 space-y-2">
                      <div className="flex items-center justify-between text-xs uppercase tracking-[0.25em] text-white/45">
                        <span>Embaralhando a fila</span>
                        <span>3 numeros unicos</span>
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

                <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <p className="text-xs uppercase tracking-[0.3em] text-white/45">Montante</p>
                    <p className="mt-2 text-xl font-semibold">{formatCurrency(financials.totalPot)}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <p className="text-xs uppercase tracking-[0.3em] text-white/45">Plataforma 20%</p>
                    <p className="mt-2 text-xl font-semibold">{formatCurrency(financials.platformCut)}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <p className="text-xs uppercase tracking-[0.3em] text-white/45">Premio total</p>
                    <p className="mt-2 text-xl font-semibold">{formatCurrency(financials.prizePool)}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <p className="text-xs uppercase tracking-[0.3em] text-white/45">Cada ganhador</p>
                    <p className="mt-2 text-xl font-semibold">{formatCurrency(financials.prizePerWinner)}</p>
                  </div>
                </div>
              </section>

              <section className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-6 backdrop-blur">
                <div className="mb-4 flex items-center gap-3">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-amber-200">
                    <Ticket className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold">Fila oficial</h3>
                    <p className="text-sm text-white/55">
                      Ordenada pela aprovacao do pagamento, com uma entrada por usuario.
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                    <div className="flex items-center gap-2 text-sm text-white/70">
                      <Calendar className="h-4 w-4 text-sky-300" />
                      <span>Data do sorteio</span>
                    </div>
                    <p className="mt-3 text-lg font-semibold">
                      {draw?.draw_date ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(draw.draw_date)) : "A definir"}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                    <div className="flex items-center gap-2 text-sm text-white/70">
                      <Sparkles className="h-4 w-4 text-amber-300" />
                      <span>Ganhadores</span>
                    </div>
                    <p className="mt-3 text-lg font-semibold">3 posicoes unicas da fila</p>
                  </div>
                </div>

                <ScrollArea className="mt-4 h-[320px] rounded-[1.5rem] border border-white/10 bg-black/25 p-2">
                  <div className="space-y-2 p-2">
                    {queue.length ? (
                      queue.map((entry) => {
                        const winner =
                          stage === "revealed" &&
                          result?.winnerPositions.includes(entry.position);

                        return (
                          <div
                            className={`rounded-2xl border px-4 py-3 transition-colors ${
                              winner
                                ? "border-amber-300/40 bg-amber-300/10"
                                : "border-white/10 bg-white/[0.03]"
                            }`}
                            key={entry.paymentId}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="font-medium">{entry.displayName}</p>
                                <p className="text-sm text-white/55">
                                  {entry.cpf ?? "CPF pendente"} • {entry.email ?? "email oculto"}
                                </p>
                              </div>
                              <div className="text-right">
                                <p className="text-xs uppercase tracking-[0.3em] text-white/40">Posicao</p>
                                <p className="text-lg font-semibold">#{entry.position}</p>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-white/55">
                        Ainda nao ha pagamentos aprovados suficientes para montar a fila desta promocao.
                      </div>
                    )}
                  </div>
                </ScrollArea>

                <div className="mt-4 flex flex-wrap gap-3">
                  <Button className="flex-1" disabled={!canStart} onClick={onStart} size="lg" variant="default">
                    {isExecuting ? <Loader2 className="animate-spin" /> : null}
                    {isExecuting ? "Travando resultado..." : "Iniciar cena do sorteio"}
                  </Button>
                  <Button className="flex-1 border-white/15" onClick={() => onOpenChange(false)} size="lg" variant="outline">
                    Fechar
                  </Button>
                </div>

                {queue.length < 3 ? (
                  <p className="mt-3 text-xs text-amber-200/80">
                    Sao necessarios pelo menos 3 pagamentos aprovados para sortear 3 numeros unicos.
                  </p>
                ) : null}

                {stage === "revealed" && result ? (
                  <div className="mt-4 rounded-[1.5rem] border border-emerald-400/20 bg-emerald-400/10 p-4">
                    <div className="flex items-center gap-2 text-emerald-200">
                      <Trophy className="h-4 w-4" />
                      <span className="text-sm font-medium">Resultado persistido</span>
                    </div>
                    <p className="mt-2 text-sm text-emerald-100/90">
                      O sorteio foi salvo com data/hora de execucao em{" "}
                      {new Intl.DateTimeFormat("pt-BR", {
                        dateStyle: "short",
                        timeStyle: "medium",
                      }).format(new Date(result.executedAt))}
                      .
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
