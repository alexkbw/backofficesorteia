import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import PageHeader from "@/components/PageHeader";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/externalClient";
import {
  getProfileDisplayName,
  normalizePaymentStatus,
  type PaymentRecord,
  type ProfileRecord,
} from "@/lib/raffle";

type ParticipantControlRecord = {
  block_reason?: string | null;
  checkout_blocked?: boolean | null;
  created_at?: string | null;
  internal_notes?: string | null;
  public_chat_blocked?: boolean | null;
  updated_at?: string | null;
  updated_by?: string | null;
  user_id: string;
};

type ChatReportSummary = {
  created_at?: string | null;
  id: string;
  reported_user_id: string;
  reporter_id: string;
  status?: string | null;
};

type ProfileFormState = {
  birth_date: string;
  cpf: string;
  display_name: string;
  full_name: string;
};

type ControlFormState = {
  block_reason: string;
  checkout_blocked: boolean;
  internal_notes: string;
  public_chat_blocked: boolean;
};

type PresenceSnapshot = {
  lastActivityByUserId: Map<string, string>;
  onlineUserIds: Set<string>;
};

function getAgeLabel(birthDate?: string | null) {
  if (!birthDate) {
    return "Nao informado";
  }

  const birthday = new Date(`${birthDate}T00:00:00`);
  const today = new Date();
  let age = today.getFullYear() - birthday.getFullYear();
  const monthDiff = today.getMonth() - birthday.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthday.getDate())) {
    age -= 1;
  }

  return `${age} anos`;
}

function formatCpf(value?: string | null) {
  const digits = (value ?? "").replace(/\D/g, "");

  if (digits.length !== 11) {
    return value ?? "Nao informado";
  }

  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}

function formatMoment(value?: string | null, fallback = "Nao informado") {
  if (!value) return fallback;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  return format(date, "dd/MM/yyyy HH:mm", { locale: ptBR });
}

function formatLastActivity(value?: string | null) {
  return formatMoment(value, "Nao observado");
}

function extractPresenceSnapshot(rawState: Record<string, unknown>): PresenceSnapshot {
  const onlineUserIds = new Set<string>();
  const lastActivityByUserId = new Map<string, string>();

  Object.entries(rawState).forEach(([presenceKey, entries]) => {
    if (presenceKey) {
      onlineUserIds.add(presenceKey);
    }

    if (!Array.isArray(entries)) {
      return;
    }

    entries.forEach((entry) => {
      if (!entry || typeof entry !== "object") {
        return;
      }

      const userId = "userId" in entry && typeof entry.userId === "string" ? entry.userId : null;
      const updatedAt = "updatedAt" in entry && typeof entry.updatedAt === "string" ? entry.updatedAt : null;

      if (userId) {
        onlineUserIds.add(userId);
      }

      if (!userId || !updatedAt) {
        return;
      }

      const currentValue = lastActivityByUserId.get(userId);

      if (!currentValue || new Date(updatedAt).getTime() > new Date(currentValue).getTime()) {
        lastActivityByUserId.set(userId, updatedAt);
      }
    });
  });

  return { lastActivityByUserId, onlineUserIds };
}

function createProfileForm(profile?: ProfileRecord | null): ProfileFormState {
  return {
    birth_date: profile?.birth_date ?? "",
    cpf: profile?.cpf ?? "",
    display_name: profile?.display_name ?? "",
    full_name: profile?.full_name ?? "",
  };
}

function createControlForm(control?: ParticipantControlRecord | null): ControlFormState {
  return {
    block_reason: control?.block_reason ?? "",
    checkout_blocked: Boolean(control?.checkout_blocked),
    internal_notes: control?.internal_notes ?? "",
    public_chat_blocked: Boolean(control?.public_chat_blocked),
  };
}

export default function Participants() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [participants, setParticipants] = useState<ProfileRecord[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [participantControls, setParticipantControls] = useState<ParticipantControlRecord[]>([]);
  const [reports, setReports] = useState<ChatReportSummary[]>([]);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const [lastActivityByUserId, setLastActivityByUserId] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [selectedParticipantKey, setSelectedParticipantKey] = useState<string | null>(null);
  const [profileForm, setProfileForm] = useState<ProfileFormState>(createProfileForm());
  const [controlForm, setControlForm] = useState<ControlFormState>(createControlForm());
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingControls, setSavingControls] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [profilesResponse, paymentsResponse, controlsResponse, reportsResponse] = await Promise.all([
        supabase.from("profiles").select("*").order("created_at", { ascending: false }),
        supabase.from("payments").select("*").order("created_at", { ascending: false }),
        supabase.from("participant_controls").select("*").order("updated_at", { ascending: false }),
        supabase.from("chat_reports").select("id, reported_user_id, reporter_id, status, created_at").order("created_at", {
          ascending: false,
        }),
      ]);

      if (profilesResponse.error || paymentsResponse.error || controlsResponse.error || reportsResponse.error) {
        throw profilesResponse.error || paymentsResponse.error || controlsResponse.error || reportsResponse.error;
      }

      setParticipants((profilesResponse.data || []) as ProfileRecord[]);
      setPayments((paymentsResponse.data || []) as PaymentRecord[]);
      setParticipantControls((controlsResponse.data || []) as ParticipantControlRecord[]);
      setReports((reportsResponse.data || []) as ChatReportSummary[]);
    } catch (error) {
      toast.error("Nao foi possivel carregar os participantes agora.");
      console.error("Failed to load participants admin data", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    let isActive = true;
    const channel = supabase.channel("participants-presence");

    const syncPresence = () => {
      if (!isActive) {
        return;
      }

      const presenceState = channel.presenceState() as Record<string, unknown>;
      const snapshot = extractPresenceSnapshot(presenceState);

      setOnlineUserIds(snapshot.onlineUserIds);
      setLastActivityByUserId((current) => {
        const next = new Map(current);
        snapshot.lastActivityByUserId.forEach((updatedAt, userId) => {
          next.set(userId, updatedAt);
        });
        return next;
      });
    };

    channel
      .on("presence", { event: "sync" }, syncPresence)
      .on("presence", { event: "join" }, syncPresence)
      .on("presence", { event: "leave" }, syncPresence)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          syncPresence();
        }
      });

    return () => {
      isActive = false;
      void supabase.removeChannel(channel);
    };
  }, []);

  const latestPaymentByUserId = useMemo(() => {
    const map = new Map<string, PaymentRecord>();

    for (const payment of payments) {
      if (!map.has(payment.user_id)) {
        map.set(payment.user_id, payment);
      }
    }

    return map;
  }, [payments]);

  const paymentsByUserId = useMemo(() => {
    const map = new Map<string, PaymentRecord[]>();

    for (const payment of payments) {
      const current = map.get(payment.user_id) ?? [];
      current.push(payment);
      map.set(payment.user_id, current);
    }

    return map;
  }, [payments]);

  const controlsByUserId = useMemo(() => {
    return new Map(participantControls.map((control) => [control.user_id, control]));
  }, [participantControls]);

  const reportsReceivedByUserId = useMemo(() => {
    const map = new Map<string, ChatReportSummary[]>();

    for (const report of reports) {
      const current = map.get(report.reported_user_id) ?? [];
      current.push(report);
      map.set(report.reported_user_id, current);
    }

    return map;
  }, [reports]);

  const reportsMadeByUserId = useMemo(() => {
    const map = new Map<string, ChatReportSummary[]>();

    for (const report of reports) {
      const current = map.get(report.reporter_id) ?? [];
      current.push(report);
      map.set(report.reporter_id, current);
    }

    return map;
  }, [reports]);

  const selectedParticipant = useMemo(() => {
    return participants.find((participant) => {
      const key = participant.user_id ?? participant.id ?? "";
      return key === selectedParticipantKey;
    }) ?? null;
  }, [participants, selectedParticipantKey]);

  const selectedParticipantUserId = selectedParticipant?.user_id ?? selectedParticipant?.id ?? null;
  const selectedControl = selectedParticipantUserId ? controlsByUserId.get(selectedParticipantUserId) ?? null : null;
  const selectedPayments = selectedParticipantUserId ? paymentsByUserId.get(selectedParticipantUserId) ?? [] : [];
  const selectedLatestPayment = selectedParticipantUserId ? latestPaymentByUserId.get(selectedParticipantUserId) ?? null : null;
  const selectedReceivedReports = selectedParticipantUserId ? reportsReceivedByUserId.get(selectedParticipantUserId) ?? [] : [];
  const selectedMadeReports = selectedParticipantUserId ? reportsMadeByUserId.get(selectedParticipantUserId) ?? [] : [];

  useEffect(() => {
    setProfileForm(createProfileForm(selectedParticipant));
    setControlForm(createControlForm(selectedControl));
  }, [selectedControl, selectedParticipant]);

  const handleOpenChat = useCallback(
    (userId?: string | null) => {
      if (!userId) {
        toast.error("Esse participante ainda nao possui um usuario valido para abrir o chat.");
        return;
      }

      setSelectedParticipantKey(null);
      navigate(`/chat?user=${encodeURIComponent(userId)}`, { state: { selectedUserId: userId } });
    },
    [navigate],
  );

  async function handleSaveProfile() {
    if (!selectedParticipant || !selectedParticipantUserId || savingProfile) return;

    setSavingProfile(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        birth_date: profileForm.birth_date || null,
        cpf: profileForm.cpf || null,
        display_name: profileForm.display_name.trim() || null,
        full_name: profileForm.full_name.trim() || null,
      })
      .eq("user_id", selectedParticipantUserId);
    setSavingProfile(false);

    if (error) {
      toast.error("Nao foi possivel salvar os dados cadastrais.");
      return;
    }

    await loadData();
    toast.success("Cadastro do participante atualizado.");
  }

  async function handleSaveControls() {
    if (!selectedParticipantUserId || savingControls) return;

    setSavingControls(true);
    const { error } = await supabase.from("participant_controls").upsert(
      {
        block_reason: controlForm.block_reason.trim() || null,
        checkout_blocked: controlForm.checkout_blocked,
        internal_notes: controlForm.internal_notes.trim() || null,
        public_chat_blocked: controlForm.public_chat_blocked,
        updated_by: session?.user.id ?? null,
        user_id: selectedParticipantUserId,
      },
      { onConflict: "user_id" },
    );
    setSavingControls(false);

    if (error) {
      toast.error("Nao foi possivel salvar os controles do participante.");
      return;
    }

    await loadData();
    toast.success("Controles do participante atualizados.");
  }

  return (
    <>
      <PageHeader
        title="Participantes"
        description="Cadastros da plataforma com painel administrativo, edicao de dados e controles operacionais"
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>CPF</TableHead>
                <TableHead>Idade</TableHead>
                <TableHead>Checkout</TableHead>
                <TableHead>Chat publico</TableHead>
                <TableHead>Ultimo Pagamento</TableHead>
                <TableHead>Ultima atividade</TableHead>
                <TableHead>Cadastro</TableHead>
                <TableHead className="text-right">Acoes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell className="py-8 text-center text-muted-foreground" colSpan={10}>
                    Carregando...
                  </TableCell>
                </TableRow>
              ) : participants.length === 0 ? (
                <TableRow>
                  <TableCell className="py-8 text-center text-muted-foreground" colSpan={10}>
                    Nenhum participante
                  </TableCell>
                </TableRow>
              ) : (
                participants.map((participant) => {
                  const userId = participant.user_id ?? participant.id ?? "";
                  const payment = latestPaymentByUserId.get(userId);
                  const control = controlsByUserId.get(userId);
                  const isOnline = onlineUserIds.has(userId);
                  const lastActivity = lastActivityByUserId.get(userId) ?? null;

                  return (
                    <TableRow
                      className="cursor-pointer transition-colors hover:bg-muted/40"
                      key={userId || participant.email || participant.created_at}
                      onClick={() => setSelectedParticipantKey(userId)}
                    >
                      <TableCell className="font-medium">
                        {getProfileDisplayName(participant, userId)}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                            isOnline ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {isOnline ? "Online" : "Offline"}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatCpf(participant.cpf)}</TableCell>
                      <TableCell className="text-muted-foreground">{getAgeLabel(participant.birth_date)}</TableCell>
                      <TableCell>
                        <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                          control?.checkout_blocked
                            ? "bg-destructive/10 text-destructive"
                            : "bg-emerald-100 text-emerald-700"
                        }`}>
                          {control?.checkout_blocked ? "Bloqueado" : "Liberado"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                          control?.public_chat_blocked
                            ? "bg-destructive/10 text-destructive"
                            : "bg-emerald-100 text-emerald-700"
                        }`}>
                          {control?.public_chat_blocked ? "Bloqueado" : "Liberado"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={normalizePaymentStatus(payment?.status)} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatLastActivity(lastActivity)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {format(new Date(participant.created_at ?? new Date().toISOString()), "dd/MM/yyyy", {
                          locale: ptBR,
                        })}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          onClick={(event) => {
                            event.stopPropagation();
                            handleOpenChat(userId);
                          }}
                          size="sm"
                          variant="outline"
                        >
                          Chat
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

      <Dialog onOpenChange={(open) => !open && setSelectedParticipantKey(null)} open={Boolean(selectedParticipant)}>
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-hidden p-0">
          {selectedParticipant ? (
            <div className="flex max-h-[92vh] flex-col">
              <DialogHeader className="border-b border-border px-6 py-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <DialogTitle>{getProfileDisplayName(selectedParticipant, selectedParticipantUserId ?? undefined)}</DialogTitle>
                    <DialogDescription>
                      Painel completo do participante com cadastro, historico e controles operacionais.
                    </DialogDescription>
                  </div>
                  <Button onClick={() => handleOpenChat(selectedParticipantUserId)} size="sm" variant="outline">
                    Chat
                  </Button>
                </div>
              </DialogHeader>

              <div className="space-y-6 overflow-y-auto px-6 py-5">
                <div className="grid gap-4 md:grid-cols-4">
                  <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Email</p>
                    <p className="mt-2 text-sm font-medium">{selectedParticipant.email ?? "Nao informado"}</p>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Ultimo pagamento</p>
                    <p className="mt-2 text-sm font-medium">{selectedLatestPayment ? normalizePaymentStatus(selectedLatestPayment.status) : "Sem pagamento"}</p>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Denuncias recebidas</p>
                    <p className="mt-2 text-sm font-medium">{selectedReceivedReports.length}</p>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Denuncias feitas</p>
                    <p className="mt-2 text-sm font-medium">{selectedMadeReports.length}</p>
                  </div>
                </div>

                <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
                  <div className="space-y-6">
                    <section className="rounded-2xl border border-border/70 p-5">
                      <div className="mb-4">
                        <h3 className="text-lg font-semibold">Dados cadastrais</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Ajuste aqui os dados que o participante solicitar. O email esta somente para consulta nesta versao.
                        </p>
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Nome completo</label>
                          <Input
                            onChange={(event) => setProfileForm((current) => ({ ...current, full_name: event.target.value }))}
                            value={profileForm.full_name}
                          />
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-medium">Nome de exibicao</label>
                          <Input
                            onChange={(event) => setProfileForm((current) => ({ ...current, display_name: event.target.value }))}
                            value={profileForm.display_name}
                          />
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-medium">CPF</label>
                          <Input
                            onChange={(event) => setProfileForm((current) => ({ ...current, cpf: event.target.value }))}
                            value={profileForm.cpf}
                          />
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-medium">Nascimento</label>
                          <Input
                            onChange={(event) => setProfileForm((current) => ({ ...current, birth_date: event.target.value }))}
                            type="date"
                            value={profileForm.birth_date}
                          />
                        </div>

                        <div className="space-y-2 md:col-span-2">
                          <label className="text-sm font-medium">Email de login</label>
                          <Input disabled value={selectedParticipant.email ?? ""} />
                        </div>
                      </div>

                      <div className="mt-4 flex justify-end">
                        <Button disabled={savingProfile || !selectedParticipantUserId} onClick={() => void handleSaveProfile()}>
                          {savingProfile ? "Salvando..." : "Salvar cadastro"}
                        </Button>
                      </div>
                    </section>

                    <section className="rounded-2xl border border-border/70 p-5">
                      <div className="mb-4">
                        <h3 className="text-lg font-semibold">Controles operacionais</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Esses controles ficam persistidos no Supabase e valem mesmo se o usuario tentar forcar a acao pelo client.
                        </p>
                      </div>

                      <div className="space-y-4">
                        <div className="flex items-center justify-between gap-4 rounded-2xl border border-border/60 px-4 py-3">
                          <div>
                            <p className="font-medium">Barrar checkout</p>
                            <p className="text-sm text-muted-foreground">
                              Impede novas tentativas de compra e abertura do checkout.
                            </p>
                          </div>
                          <Switch
                            checked={controlForm.checkout_blocked}
                            onCheckedChange={(checked) =>
                              setControlForm((current) => ({ ...current, checkout_blocked: checked }))
                            }
                          />
                        </div>

                        <div className="flex items-center justify-between gap-4 rounded-2xl border border-border/60 px-4 py-3">
                          <div>
                            <p className="font-medium">Barrar chat publico</p>
                            <p className="text-sm text-muted-foreground">
                              Impede o envio de novas mensagens no chat publico.
                            </p>
                          </div>
                          <Switch
                            checked={controlForm.public_chat_blocked}
                            onCheckedChange={(checked) =>
                              setControlForm((current) => ({ ...current, public_chat_blocked: checked }))
                            }
                          />
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-medium">Motivo informado ao participante</label>
                          <Textarea
                            onChange={(event) => setControlForm((current) => ({ ...current, block_reason: event.target.value }))}
                            placeholder="Explique o motivo do bloqueio quando necessario."
                            value={controlForm.block_reason}
                          />
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-medium">Notas internas da equipe</label>
                          <Textarea
                            onChange={(event) => setControlForm((current) => ({ ...current, internal_notes: event.target.value }))}
                            placeholder="Observacoes internas do backoffice."
                            value={controlForm.internal_notes}
                          />
                        </div>

                        <div className="text-xs text-muted-foreground">
                          Ultima atualizacao: {formatMoment(selectedControl?.updated_at)}
                        </div>

                        <div className="flex justify-end">
                          <Button disabled={savingControls || !selectedParticipantUserId} onClick={() => void handleSaveControls()}>
                            {savingControls ? "Salvando..." : "Salvar controles"}
                          </Button>
                        </div>
                      </div>
                    </section>
                  </div>

                  <div className="space-y-6">
                    <section className="rounded-2xl border border-border/70 p-5">
                      <h3 className="text-lg font-semibold">Resumo rapido</h3>
                      <div className="mt-4 space-y-3 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-muted-foreground">User ID</span>
                          <span className="max-w-[220px] truncate font-mono text-xs">{selectedParticipantUserId ?? "Nao vinculado"}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-muted-foreground">Criado em</span>
                          <span>{formatMoment(selectedParticipant.created_at)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-muted-foreground">Atualizado em</span>
                          <span>{formatMoment(selectedParticipant.updated_at)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-muted-foreground">Idade</span>
                          <span>{getAgeLabel(selectedParticipant.birth_date)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-muted-foreground">Checkout</span>
                          <span>{controlForm.checkout_blocked ? "Bloqueado" : "Liberado"}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-muted-foreground">Status</span>
                          <span>
                            {selectedParticipantUserId && onlineUserIds.has(selectedParticipantUserId) ? "Online" : "Offline"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-muted-foreground">Ultima atividade</span>
                          <span>{formatLastActivity(selectedParticipantUserId ? lastActivityByUserId.get(selectedParticipantUserId) ?? null : null)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-muted-foreground">Chat publico</span>
                          <span>{controlForm.public_chat_blocked ? "Bloqueado" : "Liberado"}</span>
                        </div>
                      </div>
                    </section>

                    <section className="rounded-2xl border border-border/70 p-5">
                      <h3 className="text-lg font-semibold">Historico de pagamentos</h3>
                      <div className="mt-4 space-y-3">
                        {selectedPayments.length === 0 ? (
                          <p className="text-sm text-muted-foreground">Nenhum pagamento encontrado.</p>
                        ) : (
                          selectedPayments.slice(0, 8).map((payment) => (
                            <div className="rounded-2xl border border-border/60 px-4 py-3" key={payment.id}>
                              <div className="flex items-center justify-between gap-3">
                                <p className="text-sm font-medium">Pagamento {payment.id.slice(0, 8)}</p>
                                <StatusBadge status={normalizePaymentStatus(payment.status)} />
                              </div>
                              <p className="mt-2 text-xs text-muted-foreground">
                                Criado em {formatMoment(payment.payment_date ?? payment.created_at)}
                              </p>
                            </div>
                          ))
                        )}
                      </div>
                    </section>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
